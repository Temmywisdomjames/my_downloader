const form = document.getElementById("url-form");
const videoInfoSection = document.getElementById("video-info");
const progressSection = document.getElementById("progress-section");
const downloadLinkSection = document.getElementById("download-link");
const errorMsg = document.getElementById("error-msg");

const thumbnail = document.getElementById("thumbnail");
const titleElem = document.getElementById("title");
const uploaderElem = document.getElementById("uploader");
const durationElem = document.getElementById("duration");
const siteNameElem = document.getElementById("site-name");
const formatSelect = document.getElementById("format-select");
const subtitleSelect = document.getElementById("subtitle-select");
const downloadBtn = document.getElementById("download-btn");
const urlInput = document.getElementById("video-url");
const darkModeToggle = document.getElementById("dark-mode-toggle");

const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const fileLink = document.getElementById("file-link");

const videoPreview = document.getElementById("video-preview");

let currentSessionId = null;
let progressInterval = null;

// --- DARK MODE HANDLING ---
function applyDarkMode(enabled) {
  if (enabled) {
    document.body.classList.add("dark-mode");
    document.querySelectorAll(".card").forEach(card => card.classList.add("dark-mode"));
  } else {
    document.body.classList.remove("dark-mode");
    document.querySelectorAll(".card").forEach(card => card.classList.remove("dark-mode"));
  }
}

darkModeToggle.addEventListener("click", () => {
  const enabled = !document.body.classList.contains("dark-mode");
  applyDarkMode(enabled);
  localStorage.setItem("darkMode", enabled ? "true" : "false");
});

window.addEventListener("DOMContentLoaded", () => {
  const saved = localStorage.getItem("darkMode");
  applyDarkMode(saved === "true");
});

// --- CLIPBOARD & DRAG SUPPORT ---
window.addEventListener("load", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text.startsWith("http")) {
      urlInput.value = text;
    }
  } catch (err) {
    console.log("Clipboard access blocked.");
  }
});

urlInput.addEventListener("dragover", (e) => {
  e.preventDefault();
});

urlInput.addEventListener("drop", (e) => {
  e.preventDefault();
  const text = e.dataTransfer.getData("text");
  if (text.startsWith("http")) {
    urlInput.value = text;
  }
});

// --- FADE IN/OUT UTILITIES ---
function fadeIn(elem) {
  elem.style.opacity = 0;
  elem.style.display = "block";
  let last = +new Date();
  const tick = function() {
    elem.style.opacity = +elem.style.opacity + (new Date() - last) / 200;
    last = +new Date();
    if (+elem.style.opacity < 1) {
      (window.requestAnimationFrame && requestAnimationFrame(tick)) || setTimeout(tick, 16);
    }
  };
  tick();
}

function fadeOut(elem) {
  elem.style.opacity = 1;
  let last = +new Date();
  const tick = function() {
    elem.style.opacity = +elem.style.opacity - (new Date() - last) / 200;
    last = +new Date();
    if (+elem.style.opacity > 0) {
      (window.requestAnimationFrame && requestAnimationFrame(tick)) || setTimeout(tick, 16);
    } else {
      elem.style.display = "none";
    }
  };
  tick();
}

// --- RESET UI ---
function resetUI() {
  fadeOut(videoInfoSection);
  fadeOut(progressSection);
  fadeOut(downloadLinkSection);
  fadeOut(errorMsg);

  progressBar.style.width = "0%";
  progressText.textContent = "";
  siteNameElem.textContent = "";
  subtitleSelect.innerHTML = '<option value="">No Subtitles</option>';
  subtitleSelect.disabled = true;
  videoPreview.style.display = "none";
  videoPreview.src = "";

  // Remove copy link button if exists
  const copyBtn = document.getElementById("copy-link-btn");
  if (copyBtn) copyBtn.remove();

  // Clear spinner and enable download button
  clearDownloadBtnSpinner();
  downloadBtn.disabled = false;
}

// --- SHOW ERROR ---
function showError(msg) {
  errorMsg.textContent = msg;
  fadeIn(errorMsg);
}

// --- FORMAT DURATION ---
function formatDuration(seconds) {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h > 0 ? h + "h " : ""}${m}m ${s}s`;
}

// --- UPDATE VIDEO PREVIEW ---
function updateVideoPreview() {
  const selectedFormatId = formatSelect.value;
  if (!selectedFormatId || !window.currentInfo) {
    videoPreview.style.display = "none";
    videoPreview.src = "";
    return;
  }

  const format = window.currentInfo.formats.find(f => f.format_id === selectedFormatId);

  const corsBlockedSites = ['tiktok.com', 'facebook.com', 'instagram.com'];
  if (format && format.url && format.vcodec !== 'none') {
    const blocked = corsBlockedSites.some(site => format.url.includes(site));
    if (!blocked) {
      videoPreview.src = format.url;
      videoPreview.style.display = "block";
    } else {
      videoPreview.style.display = "none";
      videoPreview.src = "";
    }
  } else {
    videoPreview.style.display = "none";
    videoPreview.src = "";
  }
}


// --- CLEAR SPINNER ---
function clearDownloadBtnSpinner() {
  const spinner = downloadBtn.querySelector(".spinner-border");
  if (spinner) downloadBtn.removeChild(spinner);
}

// --- SET LOADING (spinner on download button) ---
function setLoading(isLoading) {
  if (isLoading) {
    downloadBtn.disabled = true;
    downloadBtn.innerHTML = "Downloading <span class='spinner-border spinner-border-sm' role='status' aria-hidden='true'></span>";
  } else {
    downloadBtn.disabled = false;
    downloadBtn.textContent = "Download";
  }
}

// --- ADD COPY LINK BUTTON ---
function addCopyButton() {
  if (document.getElementById("copy-link-btn")) return; // avoid duplicates
  const btn = document.createElement("button");
  btn.id = "copy-link-btn";
  btn.className = "btn-primary";
  btn.style.marginLeft = "10px";
  btn.textContent = "Copy Link";
  downloadLinkSection.appendChild(btn);

  btn.addEventListener("click", () => {
    navigator.clipboard.writeText(fileLink.href).then(() => {
      btn.textContent = "Copied!";
      setTimeout(() => btn.textContent = "Copy Link", 2000);
    }).catch(() => {
      btn.textContent = "Failed to copy";
    });
  });
}

// --- SHOW DOWNLOAD LINK ---
function showDownloadLink(sessionId) {
  const fileUrl = `/download_file/${sessionId}`;
  fileLink.href = fileUrl;
  fadeIn(downloadLinkSection);
  addCopyButton();

  // Auto-click to start download
  const a = document.createElement("a");
  a.href = fileUrl;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// --- UPDATE PROGRESS BAR ---
function updateProgress(data) {
  if (data.status === "downloading" && data.progress.total_bytes > 0) {
    const percent = (data.progress.downloaded_bytes / data.progress.total_bytes) * 100;
    progressBar.style.width = `${percent.toFixed(1)}%`;
    progressText.textContent = `Downloading... ${percent.toFixed(1)}% - Speed: ${(data.progress.speed / 1024).toFixed(1)} KB/s - ETA: ${data.progress.eta}s`;
  } else if (data.status === "completed") {
    progressBar.style.width = `100%`;
    progressText.textContent = "Download completed!";
  }
}

// --- POLL PROGRESS ---
function pollProgress(sessionId) {
  progressInterval = setInterval(async () => {
    const res = await fetch(`/progress/${sessionId}`);
    const data = await res.json();

    if (data.error) {
      showError(data.error);
      clearInterval(progressInterval);
      setLoading(false);
      return;
    }

    updateProgress(data);

    if (data.status === "completed") {
      clearInterval(progressInterval);
      showDownloadLink(sessionId);
      setLoading(false);
    }
  }, 2000);
}

// --- FORM SUBMIT ---
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  resetUI();
  const url = urlInput.value.trim();
  if (!url) return;

  try {
    const res = await fetch("/info", {
      method: "POST",
      body: new URLSearchParams({ url }),
    });
    const data = await res.json();

    if (data.error) {
      showError(data.error);
      return;
    }

    currentSessionId = data.session_id;
    const info = data.info;

    window.currentInfo = info;

    siteNameElem.textContent = "Site: " + data.site;

    thumbnail.src = info.thumbnail || "";
    titleElem.textContent = info.title || "Unknown Title";
    uploaderElem.textContent = "Uploader: " + (info.uploader || "Unknown");
    durationElem.textContent = "Duration: " + (formatDuration(info.duration) || "Unknown");

    formatSelect.innerHTML = "";
    info.formats.forEach(f => {
      if (f.format_id && f.ext && (f.vcodec !== 'none' || f.acodec !== 'none')) {
        const option = document.createElement("option");
        option.value = f.format_id;
        option.text = `${f.format} - ${f.ext} - ${f.filesize ? (f.filesize / (1024*1024)).toFixed(2) + ' MB' : 'unknown size'}`;
        formatSelect.appendChild(option);
      }
    });

    subtitleSelect.innerHTML = '<option value="">No Subtitles</option>';
    if (info.subtitles && Object.keys(info.subtitles).length > 0) {
      for (const lang in info.subtitles) {
        const option = document.createElement("option");
        option.value = lang;
        option.text = lang;
        subtitleSelect.appendChild(option);
      }
      subtitleSelect.disabled = false;
    } else {
      subtitleSelect.disabled = true;
    }

    fadeIn(videoInfoSection);

    videoPreview.style.display = "none";
    videoPreview.src = "";
    updateVideoPreview();

  } catch (err) {
    showError("Failed to fetch video info. Try again.");
  }
});

formatSelect.addEventListener("change", updateVideoPreview);

// --- DOWNLOAD BUTTON CLICK ---
downloadBtn.addEventListener("click", async () => {
  if (!currentSessionId) return;

  const audioOnly = document.getElementById("audio-only").checked;
  const formatCode = audioOnly
    ? "bestaudio[ext=m4a]/bestaudio/best"
    : formatSelect.value;

  const subtitleLang = subtitleSelect.value;

  fadeIn(progressSection);
  setLoading(true);

  try {
    const params = new URLSearchParams({
      session_id: currentSessionId,
      format_code: formatCode,
    });
    if (subtitleLang) {
      params.append("subtitle_lang", subtitleLang);
    }

    const res = await fetch("/download", {
      method: "POST",
      body: params,
    });
    const data = await res.json();

    if (data.error) {
      showError(data.error);
      setLoading(false);
      return;
    }

    pollProgress(currentSessionId);
  } catch {
    showError("Failed to start download.");
    setLoading(false);
  }
});

// MULTI-DOWNLOAD WITH PROGRESS + VIDEO PREVIEW
document.getElementById("multi-download-btn").addEventListener("click", async () => {
  const urls = document.getElementById("multi-url-input").value.trim().split("\n").filter(u => u);
  if (urls.length === 0) {
    showError("Please enter at least one URL to download.");
    return;
  }

  const multiProgress = document.getElementById("multi-progress");
  multiProgress.innerHTML = ""; // Clear previous items

  for (const url of urls) {
    const card = document.createElement("div");
    card.className = "card mb-3 p-3";
    card.innerHTML = `
      <h6>${url}</h6>
      <video controls style="display:none; max-width:100%;"></video>
      <div class="progress mb-2" style="height:18px;"><div class="progress-bar"></div></div>
      <button class="btn btn-sm btn-warning ms-1 pause-btn" disabled>Pause</button>
      <button class="btn btn-sm btn-info ms-1 resume-btn" style="display:none;">Resume</button>
      <p class="status-text">Waiting...</p>
    `;
    multiProgress.appendChild(card);

    const videoEl = card.querySelector('video');
    const bar = card.querySelector('.progress-bar');
    const pauseBtn = card.querySelector('.pause-btn');
    const resumeBtn = card.querySelector('.resume-btn');
    const statusText = card.querySelector('.status-text');

    // Fetch video info
    let sessionId;
    try {
      const infoRes = await fetch("/info", {
        method: "POST",
        body: new URLSearchParams({ url }),
      });
      const info = await infoRes.json();

      if (info.error) throw new Error(info.error);
      sessionId = info.session_id;

      // Show preview (CORS-friendly)
      const mp4fmt = info.info.formats.find(f => f.vcodec !== 'none' && f.acodec !== 'none' && f.url);
      if (mp4fmt) {
        videoEl.src = mp4fmt.url;
        videoEl.style.display = 'block';
        videoEl.load();
      }

    } catch (e) {
      statusText.textContent = "❌ Info failed: " + e.message;
      continue;
    }

    // Start download
    let isPaused = false;
    try {
      const dlRes = await fetch("/download", {
        method: "POST",
        body: new URLSearchParams({ session_id: sessionId, format_code: 'best' }),
      });
      const dlData = await dlRes.json();
      if (dlData.error) {
        statusText.textContent = "❌ Download error";
        continue;
      }

      pauseBtn.disabled = false;
      statusText.textContent = "Downloading...";
    } catch (err) {
      statusText.textContent = "❌ Download start failed";
      continue;
    }

    // Poll download progress
    const interval = setInterval(async () => {
      if (isPaused) return;
      try {
        const progRes = await fetch(`/progress/${sessionId}`);
        const prog = await progRes.json();

        if (prog.error) {
          statusText.textContent = "❌ Error: " + prog.error;
          clearInterval(interval);
          return;
        }

        if (prog.status === "downloading") {
          const pct = Math.min(100, (prog.progress.downloaded_bytes / prog.progress.total_bytes) * 100 || 0);
          bar.style.width = pct + "%";
          statusText.textContent = `Downloading… ${pct.toFixed(1)}%`;
        } else if (prog.status === "finished") {
          bar.style.width = "100%";
          statusText.textContent = "Completed ✔️";
          clearInterval(interval);
          pauseBtn.disabled = true;
        } else if (prog.status === "error") {
          statusText.textContent = "❌ " + prog.progress.error;
          clearInterval(interval);
        }

      } catch (err) {
        statusText.textContent = "❌ Polling failed";
        clearInterval(interval);
      }
    }, 1500);

    // Pause/resume logic
    pauseBtn.addEventListener("click", () => {
      isPaused = true;
      pauseBtn.style.display = "none";
      resumeBtn.style.display = "inline-block";
      statusText.textContent = "Paused";
    });

    resumeBtn.addEventListener("click", () => {
      isPaused = false;
      pauseBtn.style.display = "inline-block";
      resumeBtn.style.display = "none";
      statusText.textContent = "Resuming...";
    });
  }
});
