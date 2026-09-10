const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const id = () => crypto.randomUUID().replaceAll("-", "");
const clone = (x) => structuredClone(x);
const fmt = (n) => (Number(n) || 0).toFixed(2) + " s";
const url = (aid, thumb = false) =>
  `/api/assets/${aid}/file${thumb ? "?thumbnail=true" : ""}`;
const activeStatuses = [
  "queued",
  "preparing",
  "submitting",
  "running",
  "recovering",
  "cancelling",
];
let state,
  project,
  savedProject,
  sceneId,
  segmentId,
  selected = new Set(),
  filter = "all",
  search = "",
  folder = "",
  zoom = 55,
  dirty = false,
  saving = false,
  saveTimer,
  undo = [],
  redo = [],
  modalType = "",
  connectionState = null,
  playingSequence = false,
  refreshing = false;
let speechDraft = {};
async function api(path, body, method = "POST") {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : method,
    headers:
      body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  if (!r.ok) {
    let e = await r.json().catch(() => ({ detail: r.statusText }));
    const err = Error(
      typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail),
    );
    err.status = r.status;
    throw err;
  }
  return r.json();
}
function toast(message, error = false) {
  const el = document.createElement("div");
  el.className = "toast" + (error ? " error" : "");
  el.textContent = message;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), error ? 10000 : 4500);
}
function guard(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      toast(e.message, true);
    }
  };
}
function scene() {
  return project.scenes.find((s) => s.id === sceneId) || project.scenes[0];
}
function segment() {
  return (
    scene()?.segments.find((s) => s.id === segmentId) || scene()?.segments[0]
  );
}
function allSegments() {
  return project.scenes.flatMap((s) => s.segments);
}
function checkpoint() {
  undo.push(clone(project));
  if (undo.length > 60) undo.shift();
  redo = [];
}
function changed(render = true) {
  dirty = true;
  localStorage.setItem("frameforge-unsaved", JSON.stringify(project));
  $("#save-state").textContent = "Saving…";
  $("#save-state").className = "pending";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => guard(save)(), 500);
  if (render) renderAll();
}
async function save() {
  clearTimeout(saveTimer);
  if (saving) {
    await new Promise((r) => setTimeout(r, 100));
    return save();
  }
  if (!dirty) return;
  saving = true;
  const snapshot = clone(project);
  try {
    let result;
    try {
      result = await api("/api/projects/" + project.id, snapshot, "PUT");
    } catch (e) {
      if (e.status !== 409) throw e;
      const latest = (await api("/api/state")).projects[project.id];
      const clean = (p) => {
        const c = clone(p);
        delete c.version;
        c.scenes.forEach((sc) =>
          sc.segments.forEach((s) => {
            delete s.encoded_latent;
            delete s.takes;
            delete s.main;
            delete s.duration;
            delete s.trim_in;
          }),
        );
        return JSON.stringify(c);
      };
      if (!savedProject || clean(savedProject) !== clean(latest)) throw e;
      for (const sc of snapshot.scenes) {
        for (const s of sc.segments) {
          const remote = latest.scenes
            .flatMap((x) => x.segments)
            .find((x) => x.id === s.id);
          const base = savedProject.scenes
            .flatMap((x) => x.segments)
            .find((x) => x.id === s.id);
          if (!remote || !base) continue;
          s.encoded_latent = remote.encoded_latent;
          s.takes = [...new Set([...s.takes, ...remote.takes])];
          if (s.main === base.main) s.main = remote.main;
          if (s.duration === base.duration) s.duration = remote.duration;
          if (s.trim_in === base.trim_in) s.trim_in = remote.trim_in;
          const live = allSegments().find((x) => x.id === s.id);
          if (live) {
            live.encoded_latent = s.encoded_latent;
            live.takes = s.takes;
            if (live.main === base.main) live.main = remote.main;
            if (live.trim_in === base.trim_in) live.trim_in = remote.trim_in;
            if (live.duration === base.duration)
              live.duration = remote.duration;
          }
        }
      }
      snapshot.version = latest.version;
      result = await api("/api/projects/" + project.id, snapshot, "PUT");
    }
    project.version = result.version;
    savedProject = clone(result);
    state.projects[project.id] = clone(project);
    if (
      JSON.stringify({ ...snapshot, version: result.version }) ===
      JSON.stringify(project)
    ) {
      dirty = false;
      localStorage.removeItem("frameforge-unsaved");
      $("#save-state").textContent = "Saved locally";
      $("#save-state").className = "";
    } else {
      saveTimer = setTimeout(() => guard(save)(), 100);
    }
  } finally {
    saving = false;
  }
}
function edit(fn, render = true) {
  checkpoint();
  fn();
  changed(render);
}
function randomSeed() {
  const words = crypto.getRandomValues(new Uint32Array(2));
  return (words[0] & 0x1fffff) * 4294967296 + words[1];
}
function newSegment() {
  return {
    id: id(),
    name: `Segment ${String((scene()?.segments.length || 0) + 1).padStart(2, "0")}`,
    prompt: "",
    duration: 3.5,
    overlap: 22,
    connected: !!scene()?.segments.length,
    refs: [],
    main: null,
    takes: [],
    trim_in: 0,
    seed: randomSeed(),
    steps: 20,
    width: project.width,
    height: project.height,
    continuation: null,
  };
}
function selectSegment(sid, gid, shift = false) {
  sceneId = sid;
  segmentId = gid;
  if (!shift) selected = new Set([gid]);
  else if (selected.has(gid)) selected.delete(gid);
  else selected.add(gid);
  renderAll();
}
function renderAll() {
  if (!scene()) {
    sceneId = null;
    segmentId = null;
  } else {
    sceneId = scene().id;
    segmentId = segment()?.id;
  }
  renderHeader();
  renderAssets();
  renderProperties();
  renderTimeline();
  renderPreview();
}
function renderHeader() {
  $("#project-select").innerHTML = Object.values(state.projects)
    .map(
      (p) =>
        `<option value="${p.id}" ${p.id === project.id ? "selected" : ""}>${esc(p.id === project.id ? project.name : p.name)}</option>`,
    )
    .join("");
  $("#project-summary").textContent =
    `${project.width} × ${project.height} · 24 FPS · LOCAL WORKSPACE`;
  $("#jobs-count").textContent = state.jobs.filter((j) =>
    activeStatuses.includes(j.status),
  ).length;
  $("#queue-status").textContent = state.jobs.some((j) =>
    activeStatuses.includes(j.status),
  )
    ? `${state.jobs.filter((j) => activeStatuses.includes(j.status)).length} jobs in progress / queued`
    : "Ready to create";
}
function wave(a, big = false) {
  const samples = a.waveform || Array(36).fill(0);
  const count = big ? 180 : 36;
  const stride = Math.max(1, Math.ceil(samples.length / count));
  const bars = [];
  for (let i = 0; i < samples.length; i += stride) {
    bars.push(Math.max(...samples.slice(i, i + stride)));
  }
  const peak = Math.max(0.001, ...bars);
  return `<div class="waveform ${big ? "big" : ""}">${bars.map((v) => `<i style="height:${Math.max(3, (v / peak) * 85)}%"></i>`).join("")}</div>`;
}
function assetCard(a, picker = false) {
  return `<div class="asset ${a.kind === "audio" ? "audio-card" : ""}" draggable="true" data-asset="${a.id}"><div class="asset-thumb">${a.kind === "audio" ? wave(a) : `<img draggable="false" loading="lazy" src="${url(a.id, true)}" alt="${esc(a.name)}">`}<span class="asset-kind">${a.kind === "image" ? "IMG" : fmt(a.duration)}</span>${picker ? "" : `<button class="asset-add" title="Add reference to selected segment" data-add="${a.id}">＋</button>`}</div><div class="asset-name">${esc(a.name)}</div><div class="asset-meta">${esc(a.folder || a.source)}${a.latent ? " · ◇ latent" : ""}</div></div>`;
}
function renderAssets() {
  const assets = Object.values(state.assets).sort(
    (a, b) => b.created - a.created,
  );
  $("#asset-count").textContent = assets.length;
  const folders = [
    ...new Set(assets.map((a) => a.folder).filter(Boolean)),
  ].sort();
  $("#folder-filter").innerHTML =
    '<option value="">All folders</option>' +
    folders
      .map(
        (f) =>
          `<option ${f === folder ? "selected" : ""} value="${esc(f)}">${esc(f)}</option>`,
      )
      .join("");
  const list = assets.filter(
    (a) =>
      (filter === "all" || a.kind === filter) &&
      (!folder || a.folder === folder) &&
      (!search ||
        [a.name, a.folder, ...a.tags].join(" ").toLowerCase().includes(search)),
  );
  $("#asset-list").innerHTML = list.length
    ? list.map((a) => assetCard(a)).join("")
    : `<div class="empty-assets"><span class="empty-icon">▧</span><b>${assets.length ? "No matching assets" : "Build your visual vocabulary"}</b>${assets.length ? "Try another search or filter." : "Import images, video, and audio.<br>Group your references by scene<br>and bring them into every shot."}${assets.length ? "" : '<br><button class="small" id="library-import" style="margin-top:16px">＋ Import assets</button>'}</div>`;
  $("#library-import")?.addEventListener("click", () =>
    $("#file-input").click(),
  );
  $$(".asset", $("#asset-list")).forEach((el) => {
    el.onclick = guard((e) => {
      if (e.target.closest("[data-add]")) addReference(el.dataset.asset);
      else showAsset(el.dataset.asset);
    });
    el.ondragstart = (e) =>
      e.dataTransfer.setData("application/frameforge-asset", el.dataset.asset);
  });
}
function refIds() {
  return [...new Set([...(scene()?.refs || []), ...(segment()?.refs || [])])];
}
function refList(ids, shared = false) {
  let counts = { image: 0, video: 0, audio: 0 };
  return ids
    .map((aid) => {
      const a = state.assets[aid];
      if (!a) return "";
      const index = ++counts[a.kind];
      const tag = `${{ image: "Picture", video: "Video", audio: "Audio" }[a.kind]} ${index}`;
      return `<div class="reference-slot ${shared ? "shared" : ""}"><code>${tag}</code><span title="${esc(a.name)}">${esc(a.name)}</span><button data-insert="${esc(tag)}" title="Insert reference tag into prompt">↙</button>${shared ? "<small>scene</small>" : `<button data-remove="${aid}" title="Remove reference">×</button>`}</div>`;
    })
    .join("");
}
function renderProperties() {
  const s = segment(),
    sc = scene();
  if (!s) {
    $("#properties").innerHTML =
      '<p class="hint">Add a segment to start editing.</p>';
    return;
  }
  const shared = sc.refs;
  const counts = {};
  for (const kind of ["image", "video", "audio"])
    counts[kind] = refIds().filter(
      (a) => state.assets[a]?.kind === kind,
    ).length;
  const idx = sc.segments.findIndex((x) => x.id === s.id);
  $("#properties").innerHTML =
    `<div><label class="field"><span>Segment name</span><input data-prop="name" value="${esc(s.name)}"></label><label class="field"><span>Prompt <span class="subtle">/ describe this shot</span></span><textarea data-prop="prompt" id="prompt" rows="5" placeholder="A slow dolly toward the character in &lt;Picture 1&gt;. Soft window light. She turns and says…">${esc(s.prompt)}</textarea></label><div class="row"><label class="field"><span>Delivered duration</span><input data-prop="duration" type="number" min="0.25" max="${s.type === "video" ? 86400 : 120}" step="0.041666667" value="${s.duration}"></label><label class="field"><span>Source in point</span><input data-prop="trim_in" type="number" min="0" step="0.041666667" value="${s.trim_in || 0}"></label></div><div class="inspector-section"><div class="section-heading"><h3>Motion continuity</h3><span class="badge">24 FPS</span></div><label class="check"><input id="connected" type="checkbox" ${s.connected ? "checked" : ""} ${idx === 0 ? "disabled" : ""}> Continue the previous segment</label><span class="field-label">Context overlap · frames</span><div class="overlap-options">${[22, 39, 56].map((n) => `<button data-overlap="${n}" class="${s.overlap === n ? "active" : ""}">${n} <span class="subtle">/ ${(n / 24).toFixed(2)}s</span></button>`).join("")}</div><p class="hint">Context is generated before this shot, then trimmed. H3 rounds up to its frame grid; the first selected result sets the actual duration. Use the full take for seamless latent joins.</p><label class="field"><span>Or continue an imported / saved take</span><select id="continuation"><option value="">${idx ? "Use previous segment when connected" : "Start a new chain"}</option>${Object.values(
      state.assets,
    )
      .filter((a) => a.kind === "video")
      .map(
        (a) =>
          `<option value="${a.id}" ${s.continuation === a.id ? "selected" : ""}>${esc(a.name)}${a.latent ? " ◇" : " · needs encoding"}</option>`,
      )
      .join(
        "",
      )}</select></label></div></div><div><div class="inspector-section" style="margin-top:0"><div class="section-heading"><h3>References</h3><button id="pick-refs" class="small">＋ Add</button></div><p class="hint">${counts.image}/9 images &nbsp; ${counts.video}/3 video &nbsp; ${counts.audio}/3 audio</p>${refIds().length ? refList(refIds()).replace(/<button data-remove="([^"]+)" title="Remove reference">×<\/button>/g, (m, aid) => (shared.includes(aid) ? "<small>scene</small>" : m)) : '<div class="ref-empty">Drop assets here or add from the library</div>'}<button id="scene-settings" class="small" style="margin-top:9px;width:100%">▧ Shared scene assets & settings</button></div><details><summary>Generation settings</summary><div class="row"><div class="field"><label for="segment-seed">Seed</label><div class="seed-control"><input id="segment-seed" data-prop="seed" type="number" min="0" max="9007199254740991" step="1" value="${s.seed}"><button id="randomize-segment-seed" type="button" class="small" title="Choose a new random seed" aria-label="Randomize segment seed">⚄ Randomize</button></div><label class="check"><input id="auto-segment-seed" type="checkbox" ${s.randomize_seed ? "checked" : ""}> Randomize each generation</label></div><label class="field"><span>Steps</span><input data-prop="steps" type="number" min="1" max="100" value="${s.steps}"></label></div><p class="hint">${project.width} × ${project.height} · H3 · 24 fps. Resolution is shared across the project for compatible latents.</p></details><div class="inspector-section"><div class="section-heading"><h3>Generated takes</h3><span class="count">${s.takes.length}</span></div><div class="take-list">${s.takes.map((aid) => (state.assets[aid] ? `<div class="take-item"><img src="${url(aid, true)}" alt=""><span>${esc(state.assets[aid].name)}</span><button class="small" data-take="${aid}">${s.main === aid ? "Main" : "Use"}</button></div>` : "")).join("") || '<p class="hint">Every generated take stays in your asset library. Choose any take as the main video.</p>'}</div></div><div class="inspector-section inspector-actions"><button id="duplicate-segment" class="small">Duplicate</button><button id="delete-segment" class="small danger">Delete segment</button></div></div>`;
  if (s.main) {
    const section = document.createElement("div");
    section.className = "inspector-section";
    const available = encodedContext(s);
    section.innerHTML = `<div class="section-heading"><h3>${s.type === "video" ? "Imported video" : "Video continuation"}</h3><span class="badge" id="segment-latent-badge">${available ? "Latent ready" : "Encoding needed"}</span></div><p class="hint">Continuations automatically queue an encoding of this segment’s current in-point and duration when needed.</p><div class="row"><button id="encode-segment" class="small">◇ Encode segment latents</button><button id="add-continuation" class="small">＋ Continue</button></div>`;
    $("#properties").prepend(section);
    $("#encode-segment").onclick = guard(encodeSelectedSegment);
    $("#add-continuation").onclick = addContinuation;
  }
  $$("[data-prop]", $("#properties")).forEach((el) => {
    el.onfocus = () => checkpoint();
    el.oninput = () => {
      const value = el.type === "number" ? Number(el.value) : el.value;
      if (
        el.type === "number" &&
        (!el.value ||
          !Number.isFinite(value) ||
          Number(el.min) > value ||
          (el.max && Number(el.max) < value))
      )
        return;
      s[el.dataset.prop] = value;
      changed(false);
      renderTimeline();
      renderPreview();
    };
    el.onchange = () => {
      if (el.type === "number") el.value = s[el.dataset.prop];
    };
  });
  $("#connected").onchange = (e) =>
    edit(() => (s.connected = e.target.checked));
  $("#continuation").onchange = (e) =>
    edit(() => (s.continuation = e.target.value || null));
  $$("[data-overlap]").forEach(
    (b) =>
      (b.onclick = () => edit(() => (s.overlap = Number(b.dataset.overlap)))),
  );
  $$("[data-remove]").forEach(
    (b) =>
      (b.onclick = () =>
        edit(() => (s.refs = s.refs.filter((a) => a !== b.dataset.remove)))),
  );
  $$("[data-insert]").forEach(
    (b) =>
      (b.onclick = () => {
        edit(
          () =>
            (s.prompt += (s.prompt ? " " : "") + "<" + b.dataset.insert + ">"),
        );
        $("#prompt").focus();
      }),
  );
  $$("[data-take]").forEach(
    (b) =>
      (b.onclick = () =>
        edit(() => {
          s.main = b.dataset.take;
          s.trim_in = 0;
          s.duration = state.assets[s.main].duration;
        })),
  );
  $("#auto-segment-seed").onchange = (e) =>
    edit(() => (s.randomize_seed = e.target.checked), false);
  $("#randomize-segment-seed").onclick = () => {
    edit(() => (s.seed = randomSeed()), false);
    $("#segment-seed").value = s.seed;
  };
  $("#pick-refs").onclick = () => showPicker(false);
  $("#scene-settings").onclick = () => showScene();
  $("#duplicate-segment").onclick = () =>
    edit(() => {
      const copy = clone(s);
      copy.id = id();
      copy.name += " copy";
      copy.connected = false;
      sc.segments.splice(idx + 1, 0, copy);
      segmentId = copy.id;
      selected = new Set([copy.id]);
    });
  $("#delete-segment").onclick = () =>
    edit(() => {
      sc.segments.splice(idx, 1);
      segmentId = sc.segments[Math.max(0, idx - 1)]?.id;
      selected = new Set(segmentId ? [segmentId] : []);
    });
  $("#properties").ondragover = (e) => {
    if (e.dataTransfer.types.includes("application/frameforge-asset")) {
      e.preventDefault();
      $("#properties").classList.add("drop-highlight");
    }
  };
  $("#properties").ondragleave = () =>
    $("#properties").classList.remove("drop-highlight");
  $("#properties").ondrop = guard((e) => {
    e.preventDefault();
    $("#properties").classList.remove("drop-highlight");
    const aid = e.dataTransfer.getData("application/frameforge-asset");
    if (aid) addReference(aid);
  });
}
function addReference(aid, shared = false, sc = scene(), seg = segment()) {
  const a = state.assets[aid];
  if (!a || !seg || !sc || !["image", "video", "audio"].includes(a.kind))
    return;
  const target = shared ? sc.refs : seg.refs;
  if (target.includes(aid) || (!shared && sc.refs.includes(aid))) return;
  const limit = { image: 9, video: 3, audio: 3 }[a.kind];
  const targets = shared ? sc.segments : [seg];
  if (
    targets.some(
      (s) =>
        [...new Set([...sc.refs, ...s.refs, aid])].filter(
          (x) => state.assets[x]?.kind === a.kind,
        ).length > limit,
    )
  )
    throw Error(
      `Maximum ${limit} ${a.kind} references per segment, including scene assets.`,
    );
  edit(() => target.push(aid));
  toast(`${a.name} added ${shared ? "to scene" : "as a reference"}`);
}
function renderTimeline() {
  const total = allSegments().reduce((n, s) => n + s.duration, 0);
  $("#timeline-length").textContent = fmt(total);
  const width = Math.max(900, total * zoom + 180);
  let offset = 0;
  $("#ruler").style.width = width + "px";
  $("#ruler").innerHTML = Array.from(
    { length: Math.ceil(width / zoom) },
    (_, i) =>
      `<span class="tick" style="left:${i * zoom}px">${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}</span>`,
  ).join("");
  $("#scene-list").innerHTML = project.scenes
    .map(
      (sc, i) =>
        `<div class="scene-label ${sc.id === sceneId ? "active" : ""}" data-scene="${sc.id}"><span class="eyebrow">SCENE ${String(i + 1).padStart(2, "0")}</span><div class="row between"><b>${esc(sc.name)}</b><button data-scene-edit="${sc.id}" class="icon" title="Scene settings">⋯</button></div><span class="subtle" style="font-size:9px">${sc.segments.length} shots · ${fmt(sc.segments.reduce((n, s) => n + s.duration, 0))} · ${sc.refs.length} shared</span></div>`,
    )
    .join("");
  $("#tracks").innerHTML = project.scenes
    .map((sc) => {
      let start = offset;
      let clips = sc.segments
        .map((s, i) => {
          let x = offset * zoom;
          offset += s.duration;
          let a = state.assets[s.main];
          return `<div class="clip ${s.id === segmentId ? "active" : ""} ${selected.has(s.id) ? "selected" : ""}" style="left:${x}px;width:${Math.max(14, s.duration * zoom - 4)}px" data-segment="${s.id}" data-scene="${sc.id}" draggable="true" title="${esc(s.name)} · ${fmt(s.duration)}"><div class="clip-image" ${a?.thumbnail ? `style="background-image:url('${url(a.id, true)}')"` : ""}></div>${(s.connected && i > 0) || s.continuation ? `<div class="context-shade" style="width:${Math.min((s.overlap / 24) * zoom, s.duration * zoom * 0.4)}px"></div>` : ""}<div class="resize left" data-edge="left"></div><div class="clip-content"><b>${esc(s.name)}</b><span class="clip-meta">${s.type === "video" ? "▶ Imported video" : a ? "▶ Main take" : "✦ Prompt segment"}${s.connected && i > 0 ? " · ↔ " + s.overlap + "f" : ""}</span></div><span class="clip-duration">${fmt(s.duration)}</span><div class="resize right" data-edge="right"></div></div>`;
        })
        .join("");
      return `<div class="track" data-scene="${sc.id}" style="width:${width}px">${clips}<button class="add-on-track" data-track-add="${sc.id}" style="left:${offset * zoom + 8}px" title="Add segment">＋</button></div>`;
    })
    .join("");
  $$(".scene-label").forEach(
    (el) =>
      (el.onclick = (e) => {
        if (e.target.closest("[data-scene-edit]")) {
          sceneId = el.dataset.scene;
          segmentId = scene()?.segments[0]?.id;
          showScene();
          return;
        }
        selectSegment(
          el.dataset.scene,
          project.scenes.find((x) => x.id === el.dataset.scene)?.segments[0]
            ?.id,
        );
      }),
  );
  $$("[data-track-add]").forEach(
    (b) =>
      (b.onclick = () => {
        sceneId = b.dataset.trackAdd;
        addSegment();
      }),
  );
  $$(".clip").forEach((el) => {
    el.onclick = (e) => {
      if (!e.target.closest(".resize"))
        selectSegment(el.dataset.scene, el.dataset.segment, e.shiftKey);
    };
    el.ondragstart = (e) => {
      if (e.target.closest(".resize")) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData(
        "application/frameforge-segment",
        el.dataset.segment,
      );
    };
    el.ondragover = (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add("media-drop");
    };
    el.ondragleave = () => el.classList.remove("media-drop");
    el.ondrop = guard(async (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove("media-drop");
      if (hasFiles(e)) {
        await dropTimelineFiles(
          [...e.dataTransfer.files],
          el.dataset.scene,
          el.dataset.segment,
        );
        return;
      }
      const aid = e.dataTransfer.getData("application/frameforge-asset");
      if (aid) {
        selectSegment(el.dataset.scene, el.dataset.segment);
        addReference(aid);
        return;
      }
      const gid = e.dataTransfer.getData("application/frameforge-segment");
      if (gid && gid !== el.dataset.segment)
        moveSegment(gid, el.dataset.scene, el.dataset.segment);
    });
    $$(".resize", el).forEach(
      (handle) =>
        (handle.onpointerdown = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const sc = project.scenes.find((s) => s.id === el.dataset.scene);
          const seg = sc.segments.find((s) => s.id === el.dataset.segment);
          const x = e.clientX,
            original = seg.duration,
            left = handle.dataset.edge === "left";
          checkpoint();
          handle.setPointerCapture(e.pointerId);
          const move = (ev) => {
            seg.duration = Math.min(
              seg.type === "video" ? 86400 : 120,
              Math.max(
                0.25,
                Math.round(
                  (original + ((ev.clientX - x) / zoom) * (left ? -1 : 1)) * 24,
                ) / 24,
              ),
            );
            el.style.width = Math.max(14, seg.duration * zoom - 4) + "px";
            $(".clip-duration", el).textContent = fmt(seg.duration);
          };
          const up = () => {
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", up);
            sceneId = sc.id;
            segmentId = seg.id;
            selected = new Set([seg.id]);
            changed();
          };
          handle.addEventListener("pointermove", move);
          handle.addEventListener("pointerup", up, { once: true });
        }),
    );
  });
  $$(".track").forEach((el) => {
    el.ondragover = (e) => {
      e.preventDefault();
      el.classList.add("dragover");
    };
    el.ondragleave = () => el.classList.remove("dragover");
    el.ondrop = guard(async (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove("dragover");
      if (hasFiles(e)) {
        await dropTimelineFiles([...e.dataTransfer.files], el.dataset.scene);
        return;
      }
      const aid = e.dataTransfer.getData("application/frameforge-asset");
      if (aid) {
        if (state.assets[aid]?.kind === "video")
          addVideoSegment(aid, el.dataset.scene);
        else
          toast(
            "Drop images and audio onto a segment to add references.",
            true,
          );
      }
      const gid = e.dataTransfer.getData("application/frameforge-segment");
      if (gid) moveSegment(gid, el.dataset.scene);
    });
  });
  $("#undo").disabled = !undo.length;
  $("#redo").disabled = !redo.length;
}
$("#tracks-scroll").addEventListener("scroll", () => {
  $("#scene-list").scrollTop = $("#tracks-scroll").scrollTop;
});
$("#scene-list").addEventListener("scroll", () => {
  $("#tracks-scroll").scrollTop = $("#scene-list").scrollTop;
});
function moveSegment(gid, targetId, before) {
  edit(() => {
    let old = project.scenes.find((sc) =>
      sc.segments.some((s) => s.id === gid),
    );
    let s = old.segments.find((s) => s.id === gid);
    old.segments = old.segments.filter((s) => s.id !== gid);
    let target = project.scenes.find((sc) => sc.id === targetId);
    let idx = before
      ? target.segments.findIndex((s) => s.id === before)
      : target.segments.length;
    target.segments.splice(Math.max(0, idx), 0, s);
    sceneId = targetId;
    segmentId = gid;
  });
}
function addVideoSegment(aid, targetScene = sceneId) {
  const a = state.assets[aid];
  if (a?.kind !== "video") return;
  edit(() => {
    let sc = project.scenes.find((x) => x.id === targetScene);
    if (!sc) {
      sc = { id: id(), name: "Scene 01", prompt: "", refs: [], segments: [] };
      project.scenes.push(sc);
    }
    sceneId = sc.id;
    const s = newSegment();
    Object.assign(s, {
      name: a.name,
      type: "video",
      main: aid,
      duration: a.duration,
      connected: false,
      prompt: "",
      trim_in: 0,
    });
    sc.segments.push(s);
    segmentId = s.id;
    selected = new Set([s.id]);
  });
  toast(
    "Video added as a timeline segment. Encode its latents to continue it.",
  );
}
function encodedContext(s) {
  if (!s) return null;
  const source = {
    asset_id: s.main,
    trim_in: s.trim_in || 0,
    duration: s.duration,
    width: project.width,
    height: project.height,
  };
  const saved = s.encoded_latent;
  if (
    saved &&
    Object.keys(source).every((k) => saved.source?.[k] === source[k])
  )
    return saved;
  const a = state.assets[s.main];
  return a?.latent && !s.trim_in && Math.abs(a.duration - s.duration) < 0.03
    ? a.latent
    : null;
}
async function encodeSelectedSegment() {
  const s = segment();
  if (!s?.main) throw Error("Choose a main video first.");
  await save();
  await api(`/api/assets/${s.main}/encode`, {
    project_id: project.id,
    segment_id: s.id,
  });
  toast("Segment latent encoding queued.");
  await refresh();
  showJobs();
}
function addContinuation() {
  const sc = scene(),
    previous = segment();
  edit(() => {
    const s = newSegment();
    s.name = previous.name + " · continuation";
    s.connected = true;
    sc.segments.splice(sc.segments.indexOf(previous) + 1, 0, s);
    segmentId = s.id;
    selected = new Set([s.id]);
  });
  toast(
    "Write the continuation prompt and queue it. Any needed encoding will run first.",
  );
}
function addSegment() {
  if (!scene()) {
    edit(() => {
      const sc = {
        id: id(),
        name: "Scene 01",
        prompt: "",
        refs: [],
        segments: [],
      };
      project.scenes.push(sc);
      sceneId = sc.id;
    });
  }
  edit(() => {
    const s = newSegment();
    scene().segments.push(s);
    segmentId = s.id;
    selected = new Set([s.id]);
  });
}
function renderPreview() {
  const s = segment(),
    a = state.assets[s?.main],
    v = $("#preview");
  $("#viewer-title").innerHTML =
    `${esc(scene()?.name || "No scene")} <span>/</span> ${esc(s?.name || "No segment")}`;
  $("#viewer-resolution").textContent = `${project.width} × ${project.height}`;
  if (a) {
    if (v.dataset.asset !== a.id || v.dataset.segment !== s.id) {
      v.src = url(a.id);
      v.dataset.asset = a.id;
      v.dataset.segment = s.id;
      v.onloadedmetadata = () => {
        v.currentTime = s.trim_in || 0;
        if (playingSequence) v.play().catch(() => {});
        updateTime();
      };
    }
    v.style.display = "block";
    $("#preview-empty").style.display = "none";
  } else {
    v.pause();
    v.removeAttribute("src");
    v.dataset.asset = "";
    v.dataset.segment = "";
    v.style.display = "none";
    $("#preview-empty").style.display = "block";
    playingSequence = false;
  }
  $("#main-take").innerHTML =
    '<option value="">No video selected</option>' +
    Object.values(state.assets)
      .filter((a) => a.kind === "video")
      .map(
        (a) =>
          `<option value="${a.id}" ${s?.main === a.id ? "selected" : ""}>${esc(a.name)}</option>`,
      )
      .join("");
  $("#main-take").disabled = !s;
  const context = encodedContext(s);
  $("#latent-status").textContent = context
    ? context.downloaded
      ? "◇ Segment latent saved locally"
      : "◇ Segment latent on ComfyUI"
    : "No matching segment latent";
  $("#latent-status").className = "latent-status" + (context ? " ready" : "");
  if ($("#segment-latent-badge"))
    $("#segment-latent-badge").textContent = context
      ? "Latent ready"
      : "Encoding needed";
  $("#capture-btn").disabled = !a;
  $("#play").disabled = !a;
  $("#preview-duration").textContent = fmt(s?.duration || 0);
  updateTime();
}
function updateTime() {
  const v = $("#preview"),
    s = segment();
  let t = Math.max(0, (v.currentTime || 0) - (s?.trim_in || 0));
  $("#scrubber").max = s?.duration || 1;
  $("#scrubber").value = t;
  let frame = Math.floor(t * 24);
  $("#timecode").textContent = [
    Math.floor(frame / 86400),
    Math.floor(frame / 1440) % 60,
    Math.floor(frame / 24) % 60,
    frame % 24,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  $("#play").textContent = v.paused ? "▶" : "Ⅱ";
}
function advance(dir = 1, sequence = false) {
  const all = project.scenes.flatMap((sc) =>
    sc.segments.map((s) => ({ sc, s })),
  );
  const idx = all.findIndex((o) => o.s.id === segmentId);
  let target = all[idx + dir];
  if (target) {
    if (sequence && !target.s.main) {
      playingSequence = false;
      $("#preview").pause();
      toast("Playback paused: the next segment has no main take.");
      return;
    }
    selectSegment(target.sc.id, target.s.id);
    if (sequence)
      $("#preview")
        .play()
        .catch(() => {});
  } else {
    playingSequence = false;
    $("#preview").pause();
  }
}
function modal(title, content, footer = "", eyebrow = "FRAMEFORGE") {
  modalType = "";
  $("#modal-content").innerHTML =
    `<header class="modal-header"><div><span class="eyebrow">${esc(eyebrow)}</span><h2>${esc(title)}</h2></div><button class="icon" id="close-modal" aria-label="Close dialog">×</button></header><div class="modal-body">${content}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ""}`;
  $("#close-modal").onclick = () => $("#modal").close();
  if (!$("#modal").open) $("#modal").showModal();
}
function showPicker(shared) {
  const ids = shared ? scene().refs : refIds();
  modal(
    shared ? "Add shared scene assets" : "Add segment references",
    `<p class="hint">${shared ? "Shared assets count toward the limits of every segment in this scene." : "Up to 9 images, 3 video clips, and 3 audio clips, including shared assets."}</p><div class="ref-picker">${
      Object.values(state.assets)
        .map(
          (a) =>
            `<button data-pick="${a.id}" class="${ids.includes(a.id) ? "selected" : ""}">${assetCard(a, true)}</button>`,
        )
        .join("") || "<p>Import assets to add references.</p>"
    }</div>`,
    '<button id="picker-done" class="primary">Done</button>',
  );
  $$("[data-pick]").forEach(
    (b) =>
      (b.onclick = guard(() => {
        addReference(b.dataset.pick, shared);
        b.classList.add("selected");
      })),
  );
  $("#picker-done").onclick = () =>
    shared ? showScene() : $("#modal").close();
}
function showScene() {
  const sc = scene();
  if (!sc) return;
  modal(
    "Scene settings",
    `<label class="field"><span>Scene name</span><input id="scene-name" value="${esc(sc.name)}"></label><label class="field"><span>Shared scene prompt / style, setting, characters</span><textarea id="scene-prompt" rows="4" placeholder="Shared context prepended to every segment prompt…">${esc(sc.prompt)}</textarea></label><div class="section-heading"><h3>Shared assets</h3><button id="scene-add-refs" class="small">＋ Add assets</button></div>${sc.refs.map((aid) => `<div class="reference-slot shared"><span>${esc(state.assets[aid]?.name)}</span><button data-scene-remove="${aid}">×</button></div>`).join("") || '<p class="hint">No shared references yet.</p>'}<div class="scene-modal-tools"><button id="scene-up" class="small">↑ Move earlier</button><button id="scene-down" class="small">↓ Move later</button><button id="scene-delete" class="small danger">Delete scene</button></div>`,
    '<button id="scene-done" class="primary">Save scene</button>',
  );
  const sync = () => {
    if (
      sc.name !== $("#scene-name").value ||
      sc.prompt !== $("#scene-prompt").value
    )
      edit(() => {
        sc.name = $("#scene-name").value;
        sc.prompt = $("#scene-prompt").value;
      });
  };
  $("#scene-done").onclick = () => {
    sync();
    $("#modal").close();
  };
  $("#scene-add-refs").onclick = () => {
    sync();
    showPicker(true);
  };
  $$("[data-scene-remove]").forEach(
    (b) =>
      (b.onclick = () => {
        sync();
        edit(
          () => (sc.refs = sc.refs.filter((a) => a !== b.dataset.sceneRemove)),
        );
        showScene();
      }),
  );
  for (const [key, dir] of [
    ["scene-up", -1],
    ["scene-down", 1],
  ])
    $("#" + key).onclick = () => {
      sync();
      const idx = project.scenes.indexOf(sc);
      if (project.scenes[idx + dir])
        edit(() => {
          project.scenes.splice(idx, 1);
          project.scenes.splice(idx + dir, 0, sc);
        });
    };
  $("#scene-delete").onclick = () => {
    edit(() => {
      project.scenes = project.scenes.filter((s) => s.id !== sc.id);
      sceneId = project.scenes[0]?.id;
      segmentId = scene()?.segments[0]?.id;
    });
    $("#modal").close();
  };
}
async function showAsset(aid) {
  const a = state.assets[aid];
  if (!a) return;
  const source =
    a.kind === "image"
      ? `<img class="detail-preview" src="${url(aid)}" alt="${esc(a.name)}">`
      : `<${a.kind === "audio" ? "audio" : "video"} id="asset-player" controls src="${url(aid)}"></${a.kind === "audio" ? "audio" : "video"}>`;
  modal(
    a.name,
    `${source}<div class="row"><label class="field"><span>Name</span><input id="asset-name" value="${esc(a.name)}"></label><label class="field"><span>Folder / collection</span><input id="asset-folder" value="${esc(a.folder)}" placeholder="Characters / Maya"></label></div><label class="field"><span>Tags, separated by commas</span><input id="asset-tags" value="${esc(a.tags.join(", "))}" placeholder="character, close-up, wardrobe"></label>${a.kind === "audio" ? `${wave(a, true)}<div class="row"><label class="field"><span>Trim in (seconds)</span><input id="trim-start" type="number" min="0" max="${a.duration}" step="0.01" value="0"></label><label class="field"><span>Trim out (seconds)</span><input id="trim-end" type="number" min="0" max="${a.duration}" step="0.01" value="${a.duration}"></label></div><div class="row"><button id="preview-trim" class="small">▶ Preview selection</button><button id="trim-save" class="small">Save trimmed copy</button></div><p class="hint">Trimming makes a new asset and preserves the original recording.</p>` : ""}${a.kind === "video" ? `<div class="row"><button id="add-video-timeline" class="primary small">＋ Add to timeline</button><button id="use-main" class="small">Use as main video</button><button id="encode-latent" class="small">◇ Encode latents</button></div><p class="hint">Encoding uses your project's ${project.width} × ${project.height} resolution at 24 fps. ${a.latent ? "Latent available" + (a.latent.downloaded ? " locally and on ComfyUI." : " on ComfyUI.") : "Encode this video to continue its motion in a new segment."}</p>` : ""}<div class="row" style="margin-top:20px"><button id="detail-add-ref" class="small">＋ Add as reference</button><a href="${url(aid)}" download="${esc(a.name)}${esc(a.file.slice(a.file.lastIndexOf(".")))}">Download original ↗</a></div>`,
    '<button id="asset-save" class="primary">Save asset details</button>',
    "ASSET LIBRARY",
  );
  $("#asset-save").onclick = guard(async () => {
    const result = await api(
      "/api/assets/" + aid,
      {
        name: $("#asset-name").value,
        folder: $("#asset-folder").value,
        tags: $("#asset-tags")
          .value.split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
      "PATCH",
    );
    state.assets[aid] = result;
    renderAll();
    $("#modal").close();
  });
  $("#detail-add-ref").onclick = guard(() => addReference(aid));
  if (a.kind === "video") {
    $("#add-video-timeline").onclick = guard(() => {
      addVideoSegment(aid);
      $("#modal").close();
    });
    $("#use-main").onclick = () => {
      if (!segment()) return;
      edit(() => {
        segment().main = aid;
        segment().trim_in = 0;
        segment().duration = Math.max(
          0.25,
          Math.min(segment().duration, a.duration),
        );
      });
      $("#modal").close();
    };
    $("#encode-latent").onclick = guard(async () => {
      await save();
      await api(`/api/assets/${aid}/encode`, { project_id: project.id });
      toast("Latent encoding queued.");
      showJobs();
      refresh();
    });
  }
  if (a.kind === "audio") {
    $("#preview-trim").onclick = () => {
      const v = $("#asset-player");
      v.currentTime = Number($("#trim-start").value);
      v.ontimeupdate = () => {
        if (v.currentTime >= Number($("#trim-end").value)) v.pause();
      };
      v.play();
    };
    $("#trim-save").onclick = guard(async () => {
      const b = $("#trim-save");
      b.disabled = true;
      try {
        const out = await api(`/api/assets/${aid}/trim`, {
          start: Number($("#trim-start").value),
          end: Number($("#trim-end").value),
          name: $("#asset-name").value + " · trimmed",
        });
        state.assets[out.id] = out;
        renderAssets();
        toast("Trimmed audio added to the library.");
        showAsset(out.id);
      } finally {
        b.disabled = false;
      }
    });
  }
}
async function showSettings() {
  const settings = state.settings;
  modal(
    "Local studio settings",
    `<label class="field"><span>Project name</span><input id="settings-project" value="${esc(project.name)}"></label><div class="row"><label class="field"><span>Project width · multiple of 32</span><input id="settings-width" type="number" min="32" step="32" value="${project.width}"></label><label class="field"><span>Project height · multiple of 32</span><input id="settings-height" type="number" min="32" step="32" value="${project.height}"></label></div><label class="field"><span>ComfyUI address</span><input id="comfy-url" value="${esc(settings.comfy_url)}" placeholder="http://127.0.0.1:8188"></label><div class="row"><button id="test-connection" class="small">Test connection & discover models</button><span id="connection-result" class="hint"></span></div><details><summary>Model filenames</summary>${Object.entries(
      settings.models,
    )
      .filter(([k]) => k !== "ltx_identity_lora")
      .map(
        ([k, v]) =>
          `<label class="field"><span>${esc(k.replaceAll("_", " "))}${k === "ltx_identity_lora" ? " · required for new dialogue" : ""}</span><input data-model="${k}" value="${esc(v)}" list="model-${k}"><datalist id="model-${k}"></datalist></label>`,
      )
      .join(
        "",
      )}</details><h3>Portable library</h3><p class="hint">Projects, references, generated takes, and downloaded latents live together. Download a library backup, then extract it into a new data folder and start the editor with that folder.</p><a href="/api/backup" download>Download complete library backup ↗</a>`,
    '<button id="settings-save" class="primary">Save settings</button>',
  );
  $("#test-connection").onclick = guard(async () => {
    const b = $("#test-connection");
    b.disabled = true;
    $("#connection-result").textContent = "Connecting…";
    try {
      let c = await api(
        "/api/connection?url=" + encodeURIComponent($("#comfy-url").value),
      );
      $("#connection-result").textContent = c.connected
        ? "Connected · reading models…"
        : c.error;
      if (c.connected) {
        const cap = await api(
          "/api/capabilities?url=" + encodeURIComponent($("#comfy-url").value),
        );
        for (const [k, opts] of Object.entries(cap.models))
          $("#model-" + k).innerHTML = opts
            .map((v) => `<option value="${esc(v)}">`)
            .join("");
        $("#connection-result").textContent =
          `Connected · ${cap.nodes.length} node types available`;
      }
    } finally {
      b.disabled = false;
    }
  });
  $("#settings-save").onclick = guard(async () => {
    const width = Number($("#settings-width").value),
      height = Number($("#settings-height").value);
    if (![width, height].every((n) => n >= 32 && n <= 4096 && n % 32 === 0))
      throw Error(
        "Width and height must be multiples of 32, between 32 and 4096.",
      );
    const models = Object.fromEntries(
      $$("[data-model]").map((el) => [el.dataset.model, el.value]),
    );
    state.settings = await api(
      "/api/settings",
      { comfy_url: $("#comfy-url").value, models },
      "PUT",
    );
    const name = $("#settings-project").value;
    edit(() => {
      project.name = name;
      project.width = width;
      project.height = height;
      allSegments().forEach((s) => {
        s.width = width;
        s.height = height;
      });
    });
    await save();
    $("#modal").close();
    checkConnection();
    toast("Settings saved.");
  });
}
function jobsHTML() {
  let jobs = [...state.jobs].reverse();
  return `<div class="stat-grid"><div class="stat"><strong>${jobs.filter((j) => activeStatuses.includes(j.status)).length}</strong><span>Active & queued</span></div><div class="stat"><strong>${jobs.filter((j) => j.status === "completed").length}</strong><span>Completed</span></div><div class="stat"><strong>${connectionState?.stats?.devices?.[0] ? Math.round(connectionState.stats.devices[0].vram_free / 1024 ** 3) + " GB" : "—"}</strong><span>Free GPU memory</span></div></div>${connectionState?.stats?.devices?.[0] ? `<p class="hint">${esc(connectionState.stats.devices[0].name)}</p>` : ""}<div id="job-list">${jobs.map((j) => `<article class="job"><div class="row between"><span class="job-name">${esc(j.name)}</span><span class="badge ${j.status}">${j.status}</span></div><div class="job-details">${esc(j.stage || "")} · ${j.started ? Math.round((j.finished || Date.now() / 1000) - j.started) + "s elapsed" : new Date(j.created * 1000).toLocaleTimeString()}${j.spec?.seed !== undefined ? "<br>Seed " + esc(j.spec.seed) : ""}${j.prompt_id ? "<br>Prompt " + esc(j.prompt_id) : ""}</div>${activeStatuses.includes(j.status) ? `<div class="progress"><div style="width:${j.progress ?? 3}%"></div></div>` : ""}${j.error ? `<div class="job-error">${esc(j.error)}</div>` : ""}<div class="row" style="margin-top:10px">${activeStatuses.includes(j.status) && j.kind !== "export" ? `<button data-cancel-job="${j.id}" class="small danger">Cancel job</button>` : ""}${j.download ? `<a href="${esc(j.download)}" download>Download export ↗</a>` : ""}${j.prompt_id ? `<a href="/api/jobs/${j.id}/graph" download class="subtle" style="font-size:10px">Workflow JSON</a>` : ""}${(j.results || []).map((aid) => `<button class="small" data-result="${aid}">Open ${state.assets[aid]?.kind || "asset"}</button>`).join("")}</div></article>`).join("") || '<div class="empty-assets"><b>Your queue is clear</b>Queue one shot or an entire scene.<br>Generations run one at a time to fit consumer hardware.</div>'}</div>`;
}
function showJobs() {
  modal(
    "Generation queue",
    jobsHTML(),
    '<button id="jobs-done" class="primary">Back to editor</button>',
    "LOCAL COMPUTE",
  );
  modalType = "jobs";
  bindJobs();
  $("#jobs-done").onclick = () => $("#modal").close();
}
function bindJobs() {
  $$("[data-cancel-job]").forEach(
    (b) =>
      (b.onclick = guard(async () => {
        b.disabled = true;
        await api("/api/jobs/" + b.dataset.cancelJob + "/cancel", {});
        await refresh();
      })),
  );
  $$("[data-result]").forEach(
    (b) => (b.onclick = () => showAsset(b.dataset.result)),
  );
}
function showSpeech() {
  const images = Object.values(state.assets).filter((a) => a.kind === "image"),
    audios = Object.values(state.assets).filter((a) => a.kind === "audio");
  modal(
    "Speech studio",
    `<p class="speech-intro">Start with <b>1–2 seconds of voice</b>, then generate the dialogue that follows. The reference prefix is removed from the finished sound and the tiny <b>32 × 32</b> driving video.</p><label class="field"><span>Output name</span><input id="speech-name" value="Dialogue ${state.jobs.filter((j) => j.kind === "speech").length + 1}"></label><div class="speech-row"><div class="speech-reference"><span class="eyebrow">01 / DRIVING IMAGE</span><select id="speech-image"><option value="">Choose an image…</option>${images.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select><div id="speech-image-preview"></div></div><div class="speech-reference"><span class="eyebrow">02 / VOICE PREFIX · 1–2 SECONDS</span><select id="speech-audio"><option value="">Choose an audio clip…</option>${audios.map((a) => `<option value="${a.id}">${esc(a.name)} · ${fmt(a.duration)}</option>`).join("")}</select><div id="speech-audio-preview"></div><button id="speech-trim" class="small">Trim reference ↗</button></div></div><label class="field" style="margin-top:20px"><span>03 / Performance & dialogue after the voice prefix</span><textarea id="speech-prompt" rows="4" placeholder='The same warm voice continues: "We have all the time in the world." A gentle pause, then a quiet laugh.'></textarea></label><div class="row"><label class="field"><span>Total generation length · seconds</span><input id="speech-duration" type="number" value="4" min="0.5" max="40" step="0.5"></label><div class="field"><label for="speech-seed">Seed</label><div class="seed-control"><input id="speech-seed" type="number" value="42" min="0" max="9007199254740991" step="1"><button id="randomize-speech-seed" type="button" class="small" title="Choose a new random seed" aria-label="Randomize speech seed">⚄ Randomize</button></div><label class="check"><input id="auto-speech-seed" type="checkbox" ${speechDraft.randomize_seed ? "checked" : ""}> Randomize each generation</label></div></div><div id="speech-note" class="callout success-box"></div><p class="hint">The supplied LTX workflow locks the reference audio at the start and generates the remaining audio. Set the total length longer than the reference. Both the voice prefix and extra frame-grid padding are trimmed from the output. Review the generated words and voice before adding them to a scene.</p>`,
    '<button id="speech-generate" class="primary">✦ Queue speech</button>',
    "LTX 2.3 / VOICE CONTINUATION",
  );
  const updateLength = () => {
    const a = state.assets[$("#speech-audio").value],
      total = Number($("#speech-duration").value);
    $("#speech-note").textContent = a
      ? `${fmt(total)} generation − ${fmt(a.duration)} reference prefix = ${fmt(Math.max(0, total - a.duration))} finished output`
      : "Choose a short voice reference. Its duration will be subtracted from the total generation length.";
  };
  $("#speech-image").onchange = () =>
    ($("#speech-image-preview").innerHTML = $("#speech-image").value
      ? `<img src="${url($("#speech-image").value, true)}" alt="Driving reference">`
      : "");
  $("#speech-audio").onchange = () => {
    $("#speech-audio-preview").innerHTML = $("#speech-audio").value
      ? `<audio controls src="${url($("#speech-audio").value)}"></audio>`
      : "";
    updateLength();
  };
  $("#speech-duration").oninput = updateLength;
  $("#speech-trim").onclick = () => {
    const aid = $("#speech-audio").value;
    if (aid) showAsset(aid);
    else toast("Choose a voice reference first.");
  };
  for (const key of ["name", "prompt", "image", "audio", "duration", "seed"]) {
    const el = $("#speech-" + key);
    if (speechDraft[key] !== undefined) el.value = speechDraft[key];
    el.addEventListener("input", () => (speechDraft[key] = el.value));
    el.addEventListener("change", () => (speechDraft[key] = el.value));
  }
  $("#speech-image").onchange();
  $("#speech-audio").onchange();
  $("#auto-speech-seed").onchange = (e) => {
    speechDraft.randomize_seed = e.target.checked;
  };
  $("#randomize-speech-seed").onclick = () => {
    $("#speech-seed").value = randomSeed();
    speechDraft.seed = $("#speech-seed").value;
  };
  $("#speech-generate").onclick = guard(async () => {
    const spec = {
      name: $("#speech-name").value,
      prompt: $("#speech-prompt").value,
      image_id: $("#speech-image").value,
      audio_id: $("#speech-audio").value,
      duration: Number($("#speech-duration").value),
      seed: Number($("#speech-seed").value),
      randomize_seed: $("#auto-speech-seed").checked,
    };
    await api("/api/speech", spec);
    toast(
      "Speech continuation queued. The voice prefix will be trimmed automatically.",
    );
    await refresh();
    showJobs();
  });
}
function showExport() {
  const segs = allSegments();
  const missing = segs.filter((s) => !s.main);
  modal(
    "Export your film",
    `<p class="speech-intro">${esc(project.name)} · ${segs.length} segments · ${fmt(segs.reduce((n, s) => n + s.duration, 0))}<br>${project.width} × ${project.height} · 24 fps · H.264 with AAC audio</p>${missing.length ? `<div class="callout">${missing.length} segments need a main video before export: ${missing.map((s) => esc(s.name)).join(", ")}</div>` : ""}<div class="export-options"><button class="export-option" data-export="video"><span class="large-icon">▻</span><b>Finished video</b><p>One MP4, all scenes and shots in timeline order. Context is already trimmed.</p></button><button class="export-option" data-export="clips"><span class="large-icon">▤</span><b>Individual clips</b><p>A ZIP of trimmed, numbered MP4 clips with a scene and prompt manifest.</p></button></div><p class="hint" style="margin-top:20px">Clips are normalized to the project resolution and frame rate. Source in points and timeline lengths are respected. Missing or short source media stops export with a clear error.</p>`,
  );
  $$("[data-export]").forEach(
    (b) =>
      (b.onclick = guard(async () => {
        await save();
        await api("/api/export", {
          project_id: project.id,
          mode: b.dataset.export,
        });
        await refresh();
        showJobs();
      })),
  );
}
async function queue(ids) {
  await save();
  await api("/api/queue", { project_id: project.id, segment_ids: ids });
  toast(`${ids.length} generation${ids.length > 1 ? "s" : ""} queued.`);
  await refresh();
  showJobs();
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const snap = await api("/api/state");
    const oldVersion = project?.version;
    state = snap;
    if (
      project &&
      snap.projects[project.id] &&
      !dirty &&
      !saving &&
      snap.projects[project.id].version !== oldVersion
    ) {
      project = clone(snap.projects[project.id]);
      savedProject = clone(project);
      renderAll();
    }
    renderHeader();
    renderAssets();
    if (modalType === "jobs" && $("#modal").open) {
      $(".modal-body", $("#modal")).innerHTML = jobsHTML();
      bindJobs();
    }
  } finally {
    refreshing = false;
  }
}
async function checkConnection() {
  const c = await api("/api/connection");
  connectionState = c;
  $("#connection").className = "connection" + (c.connected ? " online" : "");
  $("#connection").innerHTML =
    `<i></i> ${c.connected ? "ComfyUI connected" : "ComfyUI offline"}`;
  $("#connection").title = c.connected ? state.settings.comfy_url : c.error;
}
async function importFiles(files) {
  const imported = [];
  for (const file of files) {
    try {
      toast(`Importing ${file.name}…`);
      const form = new FormData();
      form.append("file", file);
      const a = await api("/api/assets", form);
      state.assets[a.id] = a;
      imported.push(a);
      renderAssets();
    } catch (err) {
      toast(file.name + ": " + err.message, true);
    }
  }
  if (imported.length)
    toast(
      `Imported ${imported.length} asset${imported.length === 1 ? "" : "s"}.`,
    );
  return imported;
}
async function dropTimelineFiles(files, targetScene, targetSegment) {
  const ownerId = project.id;
  if (!targetSegment) {
    const videoFiles = files.filter(
      (f) =>
        f.type.startsWith("video/") ||
        /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(f.name),
    );
    if (videoFiles.length !== files.length)
      toast(
        "Only videos create timeline segments. Drop other media onto an existing segment.",
        true,
      );
    files = videoFiles;
  }
  const assets = await importFiles(files);
  const sc = project.scenes.find((x) => x.id === targetScene);
  const seg = sc?.segments.find((x) => x.id === targetSegment);
  if (
    project.id !== ownerId ||
    (targetScene && !sc) ||
    (targetSegment && !seg)
  ) {
    toast(
      "Files imported to the library. The original timeline target changed; drop the assets again.",
      true,
    );
    return;
  }
  for (const a of assets) {
    if (targetSegment) {
      try {
        addReference(a.id, false, sc, seg);
      } catch (err) {
        toast(`${a.name}: ${err.message} Asset kept in the library.`, true);
      }
    } else if (a.kind === "video") addVideoSegment(a.id, targetScene);
  }
}
const timelineDropArea = $("#tracks-scroll");
timelineDropArea.addEventListener("dragover", (e) => {
  e.preventDefault();
});
timelineDropArea.addEventListener(
  "drop",
  guard(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (hasFiles(e))
      await dropTimelineFiles([...e.dataTransfer.files], sceneId);
    else {
      const aid = e.dataTransfer.getData("application/frameforge-asset");
      if (state.assets[aid]?.kind === "video") addVideoSegment(aid);
      else if (aid)
        toast("Drop images and audio onto a segment to add references.", true);
    }
  }),
);
$("#file-input").onchange = guard(async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  await importFiles(files);
});
const library = $(".library");
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
library.addEventListener("dragover", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  library.classList.add("file-drop");
});
library.addEventListener("dragleave", (e) => {
  if (!library.contains(e.relatedTarget)) library.classList.remove("file-drop");
});
library.addEventListener(
  "drop",
  guard(async (e) => {
    library.classList.remove("file-drop");
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    await importFiles([...e.dataTransfer.files]);
  }),
);
// Keep dropped files from replacing the editor with a browser file preview.
window.addEventListener("dragover", (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener("drop", (e) => {
  if (hasFiles(e)) {
    e.preventDefault();
    library.classList.remove("file-drop");
  }
});

function setupPanelResize() {
  const editor = $(".editor");
  let sizes = {};
  try {
    sizes = JSON.parse(localStorage.getItem("frameforge-panel-sizes")) || {};
  } catch {}
  const definitions = [
    [".library", "library", "vertical", 1, 180, 500],
    [".inspector", "inspector", "vertical", -1, 240, 600],
    [".timeline", "timeline", "horizontal", -1, 160, 650],
    [".scene-list", "scenes", "vertical", 1, 120, 360],
    [".inspector", "inspector-height", "horizontal", 1, 200, 900],
  ];
  function apply() {
    const narrow = innerWidth <= 860;
    for (const [selector, key, axis, sign, min, max] of definitions) {
      let value = sizes[key];
      if (!Number.isFinite(value)) continue;
      let limit = max;
      if (key === "library")
        limit = Math.min(
          max,
          editor.clientWidth -
            (narrow ? 300 : $(".inspector").offsetWidth + 340),
        );
      if (key === "inspector")
        limit = Math.min(
          max,
          editor.clientWidth - $(".library").offsetWidth - 340,
        );
      if (key === "timeline" && !narrow)
        limit = Math.min(max, editor.clientHeight - 280);
      editor.style.setProperty(
        `--${key}-size`,
        `${Math.max(min, Math.min(limit, value))}px`,
      );
    }
  }
  for (const [selector, key, axis, sign, min, max] of definitions) {
    const panel = $(selector),
      handle = document.createElement("div");
    handle.className = `panel-divider divider-${key}`;
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", axis);
    handle.setAttribute(
      "aria-label",
      `Resize ${key === "scenes" ? "scene list" : key === "inspector-height" ? "properties height" : key} panel`,
    );
    handle.title =
      "Drag to resize · Double-click to reset · Arrow keys to adjust";
    (key === "scenes" ? $(".timeline-body") : panel).append(handle);
    const saveSizes = () => {
      try {
        localStorage.setItem("frameforge-panel-sizes", JSON.stringify(sizes));
      } catch {}
    };
    handle.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const vertical = axis === "vertical";
      const initial = vertical ? panel.offsetWidth : panel.offsetHeight;
      const origin = vertical ? e.clientX : e.clientY;
      handle.setPointerCapture(e.pointerId);
      document.body.classList.add("resizing-panels");
      handle.onpointermove = (ev) => {
        sizes[key] = Math.max(
          min,
          Math.min(
            max,
            initial + sign * ((vertical ? ev.clientX : ev.clientY) - origin),
          ),
        );
        apply();
      };
      const finish = () => {
        handle.onpointermove = null;
        document.body.classList.remove("resizing-panels");
        saveSizes();
      };
      handle.onpointerup = finish;
      handle.onpointercancel = finish;
      handle.onlostpointercapture = finish;
    };
    handle.ondblclick = () => {
      delete sizes[key];
      editor.style.removeProperty(`--${key}-size`);
      saveSizes();
    };
    handle.onkeydown = (e) => {
      const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }[
        e.key
      ];
      if (
        !delta ||
        (axis === "vertical"
          ? !["ArrowLeft", "ArrowRight"].includes(e.key)
          : !["ArrowUp", "ArrowDown"].includes(e.key))
      )
        return;
      e.preventDefault();
      sizes[key] = Math.max(
        min,
        Math.min(
          max,
          (axis === "vertical" ? panel.offsetWidth : panel.offsetHeight) +
            delta * sign * 16,
        ),
      );
      apply();
      saveSizes();
    };
  }
  apply();
  window.addEventListener("resize", apply);
}
setupPanelResize();
for (const selector of ["#import-btn", "#empty-import"])
  $(selector).onclick = () => $("#file-input").click();
$("#asset-search").oninput = (e) => {
  search = e.target.value.toLowerCase();
  renderAssets();
};
$("#folder-filter").onchange = (e) => {
  folder = e.target.value;
  renderAssets();
};
$$("[data-kind]").forEach(
  (b) =>
    (b.onclick = () => {
      filter = b.dataset.kind;
      $$("[data-kind]").forEach((x) => x.classList.toggle("active", x === b));
      renderAssets();
    }),
);
$("#settings-btn").onclick = showSettings;
$("#connection").onclick = showSettings;
$("#speech-btn").onclick = showSpeech;
$("#jobs-btn").onclick = showJobs;
$("#export-btn").onclick = showExport;
$("#add-scene").onclick = () =>
  edit(() => {
    const sc = {
      id: id(),
      name: `Scene ${String(project.scenes.length + 1).padStart(2, "0")}`,
      prompt: "",
      refs: [],
      segments: [],
    };
    project.scenes.push(sc);
    sceneId = sc.id;
    const s = newSegment();
    s.connected = false;
    sc.segments.push(s);
    segmentId = s.id;
    selected = new Set([s.id]);
  });
$("#add-segment").onclick = addSegment;
$("#queue-selected").onclick = guard(() =>
  queue([...selected].filter((gid) => allSegments().some((s) => s.id === gid))),
);
$("#queue-scene").onclick = guard(() =>
  queue(scene().segments.map((s) => s.id)),
);
$("#main-take").onchange = (e) =>
  edit(() => {
    segment().main = e.target.value || null;
    segment().trim_in = 0;
    if (segment().main)
      segment().duration = state.assets[segment().main].duration;
  });
$("#asset-details").onclick = () => {
  if (segment()?.main) showAsset(segment().main);
};
$("#play").onclick = () => {
  const v = $("#preview");
  if (v.paused) {
    playingSequence = true;
    const s = segment();
    if (v.currentTime >= (s.trim_in || 0) + s.duration - 0.05)
      v.currentTime = s.trim_in || 0;
    v.play().catch((e) => toast(e.message, true));
  } else {
    playingSequence = false;
    v.pause();
  }
  updateTime();
};
$("#prev-segment").onclick = () => advance(-1);
$("#next-segment").onclick = () => advance(1);
$("#preview").ontimeupdate = () => {
  updateTime();
  const s = segment();
  if (
    s &&
    playingSequence &&
    $("#preview").currentTime >= (s.trim_in || 0) + s.duration - 0.025
  ) {
    $("#preview").pause();
    advance(1, true);
  }
};
$("#preview").onended = () => {
  if (playingSequence) advance(1, true);
};
$("#preview").onpause = updateTime;
$("#preview").onplay = updateTime;
$("#scrubber").oninput = (e) => {
  if ($("#preview").dataset.asset)
    $("#preview").currentTime =
      Number(e.target.value) + (segment()?.trim_in || 0);
};
$("#capture-btn").onclick = guard(async () => {
  const s = segment();
  if (!s?.main) return;
  const a = await api(`/api/assets/${s.main}/capture`, {
    time: $("#preview").currentTime,
    name: s.name + " · frame " + Math.round($("#preview").currentTime * 24),
  });
  state.assets[a.id] = a;
  renderAssets();
  toast("Frame saved as an image reference.");
});
$("#zoom").oninput = (e) => {
  zoom = Number(e.target.value);
  renderTimeline();
};
function historyStep(forward) {
  const source = forward ? redo : undo,
    target = forward ? undo : redo;
  if (!source.length) return;
  target.push(clone(project));
  const version = project.version;
  project = source.pop();
  project.version = version;
  changed();
}
$("#undo").onclick = () => historyStep(false);
$("#redo").onclick = () => historyStep(true);
$("#project-select").onchange = guard(async (e) => {
  const pid = e.target.value;
  await save();
  project = clone(state.projects[pid]);
  savedProject = clone(project);
  sceneId = project.scenes[0]?.id;
  segmentId = scene()?.segments[0]?.id;
  selected = new Set(segmentId ? [segmentId] : []);
  undo = [];
  redo = [];
  localStorage.setItem("frameforge-project", pid);
  renderAll();
});
$("#new-project").onclick = guard(async () => {
  await save();
  const p = await api("/api/projects", {
    name: "Untitled film " + (Object.keys(state.projects).length + 1),
  });
  state.projects[p.id] = p;
  project = clone(p);
  savedProject = clone(project);
  sceneId = p.scenes[0].id;
  segmentId = scene().segments[0].id;
  selected = new Set([segmentId]);
  undo = [];
  redo = [];
  renderAll();
});
$("#modal").addEventListener("close", () => (modalType = ""));
$("#modal").onclick = (e) => {
  if (e.target === $("#modal")) $("#modal").close();
};
window.addEventListener("keydown", (e) => {
  if (e.target.matches("input,textarea,select") || $("#modal").open) return;
  if (e.code === "Space") {
    e.preventDefault();
    $("#play").click();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    historyStep(e.shiftKey);
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    guard(save)();
  }
});
window.addEventListener("beforeunload", (e) => {
  if (dirty || saving) {
    e.preventDefault();
    e.returnValue = "";
  }
});
await guard(async () => {
  state = await api("/api/state");
  const pid = localStorage.getItem("frameforge-project");
  project = clone(state.projects[pid] || Object.values(state.projects)[0]);
  savedProject = clone(project);
  const unsaved = localStorage.getItem("frameforge-unsaved");
  if (unsaved) {
    try {
      const draft = JSON.parse(unsaved);
      if (state.projects[draft.id]) {
        project = draft;
        dirty = true;
        toast(
          "Recovered unsaved edits from this browser. Save or export them before switching projects.",
        );
      }
    } catch {}
  }
  sceneId = project.scenes[0]?.id;
  segmentId = scene()?.segments[0]?.id;
  selected = new Set(segmentId ? [segmentId] : []);
  renderAll();
  if (!state.media_available)
    toast(
      "Install the media dependencies to import, trim, and export audio/video.",
      true,
    );
  guard(checkConnection)();
  setInterval(() => guard(refresh)(), 3000);
  setInterval(() => guard(checkConnection)(), 15000);
})();
