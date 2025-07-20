import os
import uuid
import shutil
import subprocess
import time
from fastapi import FastAPI, Form, Request, BackgroundTasks
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from yt_dlp import YoutubeDL
from typing import Dict

from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi.middleware.cors import CORSMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import JSONResponse as StarletteJSONResponse

from apscheduler.schedulers.background import BackgroundScheduler

app = FastAPI()

# --- Rate Limiter setup ---
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: StarletteRequest, exc: RateLimitExceeded):
    return StarletteJSONResponse(
        status_code=429,
        content={"error": "Rate limit exceeded. Try again later."},
    )

# CORS for frontend if needed (optional)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # adjust for security
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

templates = Jinja2Templates(directory="templates")

DOWNLOAD_DIR = "downloads"
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory="static"), name="static")

video_sessions: Dict[str, Dict] = {}

def virus_scan(file_path: str) -> bool:
    """Scan file with ClamAV, return True if no virus found."""
    result = subprocess.run(["clamscan", file_path], capture_output=True, text=True)
    return "OK" in result.stdout

def progress_hook(d, session_id):
    if session_id not in video_sessions:
        return
    if d["status"] == "downloading":
        video_sessions[session_id]["progress"] = {
            "downloaded_bytes": d.get("downloaded_bytes", 0),
            "total_bytes": d.get("total_bytes", 0) or d.get("total_bytes_estimate", 0),
            "speed": d.get("speed", 0),
            "eta": d.get("eta", 0),
        }
    elif d["status"] == "finished":
        video_sessions[session_id]["progress"] = {"finished": True}
        video_sessions[session_id]["status"] = "finished"

def run_yt_dlp(url: str, session_id: str, format_code: str = "bestvideo+bestaudio/best", subtitle_lang: str = None):
    print(f"Starting download for session {session_id} with url: {url} and format: {format_code}, subtitle: {subtitle_lang}")
    try:
        session_path = os.path.join(DOWNLOAD_DIR, session_id)
        os.makedirs(session_path, exist_ok=True)

        ydl_opts = {
            "outtmpl": f"{session_path}/%(title)s.%(ext)s",
            "format": format_code,
            "noplaylist": True,
            "quiet": True,
            "progress_hooks": [lambda d: progress_hook(d, session_id)],
            "continuedl": True,  # support resume
        }

        if subtitle_lang:
            ydl_opts.update({
                "writesubtitles": True,
                "subtitlelangs": [subtitle_lang],
                "subtitlesformat": "srt",  # or vtt
                "embedsubtitles": False,   # change to True if you want embedded subs
            })

        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            filename = ydl.prepare_filename(info)

        # Virus scan
        if not virus_scan(filename):
            os.remove(filename)
            video_sessions[session_id]["status"] = "error"
            video_sessions[session_id]["progress"] = {"error": "Virus detected. Download aborted."}
            return

        video_sessions[session_id]["file_path"] = filename
        video_sessions[session_id]["status"] = "completed"

    except Exception as e:
        video_sessions[session_id]["status"] = "error"
        video_sessions[session_id]["progress"] = {"error": str(e)}

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.post("/info", response_class=JSONResponse)
@limiter.limit("10/minute")
async def get_video_info(request: Request, url: str = Form(...)):
    session_id = str(uuid.uuid4())
    try:
        ydl_opts = {"quiet": True, "skip_download": True, "writesubtitles": True, "writeautomaticsub": True}
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            site = info.get("extractor_key", "unknown")

        # Extract subtitles and automatic captions
        subtitles = info.get("subtitles", {})
        automatic_captions = info.get("automatic_captions", {})
        subs_combined = {**subtitles, **automatic_captions}

        video_sessions[session_id] = {
            "info": {
                "title": info.get("title"),
                "thumbnail": info.get("thumbnail"),
                "duration": info.get("duration"),
                "uploader": info.get("uploader"),
                "formats": info.get("formats"),
                "webpage_url": info.get("webpage_url"),
            },
            "subtitles": subs_combined,
            "status": "ready",
            "progress": {},
            "file_path": None,
            "site": site,
        }
        return {"session_id": session_id, "info": video_sessions[session_id]["info"], "subtitles": subs_combined, "site": site}
    except Exception as e:
        return {"error": str(e)}

@app.post("/download", response_class=JSONResponse)
@limiter.limit("5/minute")
async def download_video(request: Request, background_tasks: BackgroundTasks,
                         session_id: str = Form(...), 
                         format_code: str = Form("bestvideo+bestaudio/best"),
                         subtitle_lang: str = Form(None)):
    if session_id not in video_sessions:
        return {"error": "Invalid session_id"}
    if video_sessions[session_id]["status"] not in ["downloading", "ready", "error"]:
        return {"error": f"Download cannot be started. Current status: {video_sessions[session_id]['status']}"}


    video_url = video_sessions[session_id]["info"].get("webpage_url")
    if not video_url:
        return {"error": "Video URL missing"}

    video_sessions[session_id]["status"] = "downloading"
    background_tasks.add_task(run_yt_dlp, video_url, session_id, format_code, subtitle_lang)

    return {"status": "started"}

@app.get("/progress/{session_id}", response_class=JSONResponse)
@limiter.limit("20/minute")
async def get_progress(request: Request, session_id: str):
    if session_id not in video_sessions:
        return {"error": "Invalid session_id"}
    return {"status": video_sessions[session_id]["status"], "progress": video_sessions[session_id]["progress"]}

@app.get("/download_file/{session_id}", response_class=FileResponse)
@limiter.limit("10/minute")
async def serve_file(request: Request, session_id: str):
    if session_id not in video_sessions:
        return JSONResponse({"error": "Invalid session_id"})
    file_path = video_sessions[session_id].get("file_path")
    if not file_path or not os.path.exists(file_path):
        return JSONResponse({"error": "File not available or not found"})

    filename = os.path.basename(file_path)
    return FileResponse(path=file_path, filename=filename, media_type="application/octet-stream")

# --- Cleanup Task ---

def cleanup():
    now = time.time()
    for folder in os.listdir(DOWNLOAD_DIR):
        path = os.path.join(DOWNLOAD_DIR, folder)
        if os.path.isdir(path):
            if now - os.path.getmtime(path) > 3600:
                print(f"Cleaning up folder: {path}")
                shutil.rmtree(path, ignore_errors=True)
                video_sessions.pop(folder, None)

scheduler = BackgroundScheduler()
scheduler.add_job(cleanup, 'interval', minutes=30)
scheduler.start()
