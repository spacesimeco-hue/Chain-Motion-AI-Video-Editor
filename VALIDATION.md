# Validation record

Validated on September 10, 2026. This record describes observed results, not a guarantee of generation quality on every model, GPU, or prompt.

## Automated and local integration checks

- **14 automated tests passed** in the project's installed `.venv`.
- Python compilation and JavaScript syntax validation passed.
- Imported a 4-second video, audio fixture, and image through the actual HTTP API.
- Saved a 1.5-second trimmed audio copy and a captured video frame as assets.
- Verified byte-range video serving (206 response with the requested bytes).
- Downloaded a complete library backup and restored it into a separate temporary folder: **4 projects, 13 assets, and 3 local latents** were intact.
- Verified stale project versions reject conflicting saves and cross-origin writes are rejected.
- Exported an edited clip with a source in point as a finished MP4 and an individual-clip ZIP.
- Verified missing or short main videos fail explicitly rather than disappearing from exports.
- Added a regression test proving multi-clip export does not accumulate per-clip AAC priming gaps. Sequence intermediates use PCM audio, with AAC encoded once for the final movie.
- Browser checks covered project selection, prompts, numerical durations, segment creation, overlap selection, main-take assignment, autosave, speech reference selection, and the displayed prefix/output duration calculation.

## Live ComfyUI checks

Server: `http://192.168.88.253:8188`, ComfyUI 0.34.5. The primary device reported an NVIDIA RTX 3090. Each live graph was checked against the installation's actual `/object_info`.

| Check | Observed result |
| --- | --- |
| First H3 segment | Requested 3.5 seconds at 608 × 352, 20 sampling steps. Completed in approximately 433 seconds including model loading. Returned a 90-frame / 3.75-second video with audio. |
| Durable monitoring | Restarted the editor while that job was active. It recovered the existing prompt and downloaded its outputs without submitting a duplicate. |
| H3 continuation | Requested 3 seconds with 22 context frames and an image captured from the first take. Completed in approximately 117 seconds. Returned an 85-frame / 3.54-second delivered clip. The graph loaded the first take's exact saved latent. |
| Latent retention | Both H3 AV latents were saved on ComfyUI and downloaded into the local library. Each take has a distinct directory/path. |
| Imported-video encoding | Encoded the 4-second imported video into an H3-compatible AV latent, then downloaded it. Completed in approximately 18 seconds. |
| 32-pixel baseline | The supplied locked-audio graph ran successfully as a 32 × 32 single-stage video. This earlier baseline did not test voice-prefix extension. |
| Revised voice-prefix workflow | Used a 1.5-second excerpt of `overestimated.wav`, named in the supplied workflow, with a 4-second generation. Completed in approximately 159 seconds. Returned a **2.5-second FLAC** and a **2.5-second 32 × 32 MP4**, with the reference prefix removed from both. No identity LoRA was used. |
| Cancellation | A newly queued local test job was cancelled and never submitted to ComfyUI. Automated tests also verify that cancellation does not interrupt a different active prompt. |
| Generated sequence exports | Exported the two generated H3 shots as a **7.29-second 608 × 352 MP4 with audio** and as individually numbered clips with a JSON manifest. Both jobs completed. |

Relevant retained job IDs:

- First H3 shot: `f40f90d559d847b0b541a1234bc0656d`
- H3 continuation: `8eed5caab2ad400f91ba4d10674b63e8`
- Imported-video latent: `a472737ce6784f9b8998b45de546126a`
- Revised voice-prefix speech: `e57e9b95d5d448e5a03e0a0012bbea17`
- Final sequence export: `779378e533d04f9382de296138ee602d`
- Final individual clips: `60ea77bd116b42c1898e7c6e0b5de7aa`

Graphs, job records, media, and latents are retained in `data/`. Test references and results are grouped in the **Validation** asset folder. A fresh **Untitled film** project is available alongside the clearly named validation projects.

## Scope and remaining practical limits

- The live speech test proves the longer latent, generated tail, automatic prefix trimming, sound-file output, and 32-pixel driving-video path. Exact word delivery and voice identity were not independently scored; listen to generated dialogue before use.
- The maximum 9/3/3 reference counts and all overlap frame calculations were tested in graph/model validation. The live continuation used one image and 22-frame context; large reference batches and 39/56-frame live generations were not run to avoid unnecessary GPU load.
- Windows and macOS launch scripts/library portability are implemented but were not exercised on those operating systems. Live validation ran on Linux.
- H3 duration grid rounding is exposed in the UI. Direct latent continuation rejects a main video whose timeline duration was trimmed away from that latent's end.
- Moving to a different ComfyUI server requires restoring its output-side latent files or re-encoding local media; a portable library does not install ComfyUI models or custom nodes.
- The editor implements the requested generative scene/segment workflow. Conventional layered compositing, titles, effects, keyframes, transitions, and independent audio mixing are outside this implementation.

## Imported timeline segments and workspace ergonomics

- 18 unit tests pass, including trimmed segment context invalidation, source bounds, mixed encode/generate queues, and rejection of stale queued encodings.
- Live ComfyUI test: imported a timeline source with a 0.5-second in point and 3-second duration; encoding completed and matching latents were downloaded and attached to the segment.
- Browser verified click-and-drag library resize (216 to 252 px), double-click reset (200 px), keyboard adjustment, persistence on reload, narrow-layout properties height divider, and favicon link. No browser console errors.
- File dropping uses the same per-file upload function as the file picker, with drop highlighting and prevention of accidental browser navigation. Native operating-system file dragging was not automated.

Timeline drop update: verified video asset drag creates a timeline segment in the browser; verified full-height library and timeline have aligned bottom edges. Focused JavaScript checks passed for shared-reference capacities, duplicate exclusion, video-only empty timeline drops, and file-to-segment reference routing. Native OS file drops were not automated.

Automatic continuation encoding and latest-take selection: 21 tests passed, covering stale encoding replacement, matching active-job reuse, valid latent reuse, and replacing the main take while preserving take history and resetting source trim. No generation graph changes or new GPU sampling tests were needed.

LAN hosting: 26 unit tests pass. A temporary isolated server bound to all IPv4 interfaces served the editor via 192.168.1.10:8788; same-origin project creation succeeded and cross-origin writes returned 403. The test server was stopped. Verified ID generation without secure-context randomUUID. Access from a separate physical device depends on local firewall/network routing and was not tested.

Cancellation and workspace updates: 29 tests pass, including empty-success ComfyUI cancellation responses, malformed-response diagnostics, portable project export/import with media and ID remapping, and project deletion preserving assets. Browser verified 0.5 MP calculation (928 × 544, 0.505 actual MP at the current aspect ratio), saved-project controls, and no console errors. No GPU generations submitted for these UI changes.

Disconnected cancellation: 32 tests pass. Regression checks cover cancellation while offline, disconnect during history polling, progression to the next queued job, and interrupting only an owned active prompt. Local cancellation is terminal even when remote confirmation fails; monitoring HTTP requests use bounded five-second timeouts and cancellation calls use three-second timeouts.
