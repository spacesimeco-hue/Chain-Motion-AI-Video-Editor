
# Quick Start Video
<a href="https://youtu.be/kAdkr4p6UZE">
  <img width="400" alt="Get Started Video" src="https://github.com/user-attachments/assets/2de7febb-5c68-435a-83f7-014a00f36729" />
</a>



# Frameforge

Frameforge is a local video studio for creating scene-based AI videos with ComfyUI. Organize references, write prompts, generate and compare takes, connect motion between segments, stage 3D reference images, and export a finished film from one browser workspace.

The Python service stores your library, schedules jobs, and exports media. The browser provides the editor. There is no frontend build step. Cloud inference and language-model connections are optional; local AI generation requires a separately configured ComfyUI installation.

![Frameforge editor: asset library at left, preview in the center, segment properties at right, and timeline below](docs/screenshots/editor.png)

*Screenshots show a separate demonstration library. “ComfyUI offline,” empty queues, and missing-video notices are intentional: no AI jobs were submitted for these screenshots. The demo uses port 8799; normal installation uses 8787.*

## Contents

- [Features at a glance](#features-at-a-glance)
- [Requirements](#requirements)
- [Installation and launch](#installation-and-launch)
- [First-time setup](#first-time-setup)
- [Create your first sequence](#create-your-first-sequence)
- [Editor and asset library](#editor-and-asset-library)
- [Prompts and references](#prompts-and-references)
- [Motion continuity and timing](#motion-continuity-and-timing)
- [Scene Writer](#scene-writer)
- [Speech Studio](#speech-studio)
- [Set Studio](#set-studio)
- [Cloud inference and Turbo](#cloud-inference-and-turbo)
- [Generation queue](#generation-queue)
- [Save, recover, and manage projects](#save-recover-and-manage-projects)
- [Export your film](#export-your-film)
- [LAN access](#lan-access)
- [Backup and moving your library](#backup-and-moving-your-library)
- [Keyboard and mouse controls](#keyboard-and-mouse-controls)
- [Troubleshooting](#troubleshooting)
- [Development and workflow sources](#development-and-workflow-sources)

## Features at a glance

| Area | What you can do |
| --- | --- |
| Timeline editing | Arrange scenes and segments on one track; import videos; trim, resize, reorder, duplicate, multi-select, zoom, undo, and redo. |
| Reference library | Import images, videos, and audio; organize names, folders, and tags; describe images; capture video frames; trim audio. |
| H3 video generation | Use text and multimodal references, shared scene context, configurable seeds and steps, multiple takes, and local latent motion continuation. |
| Prompt editing | Switch between full prompts and structured fields; insert numbered reference tags; reorder image references. |
| Scene Writer | Generate or paste structured scripts, check required sections, preview segments, and approve a new scene or update an existing segment. |
| Speech Studio | Generate dialogue following a short voice reference with the supplied LTX 2.3 workflow. |
| Set Studio | Reconstruct Gaussian splats, stage mannequins and GLB props, pose limbs and fingers, save cameras, and render reference images. |
| Qwen image editor | Transform a Set Studio camera render with up to nine additional image references; optionally improve the prompt with a vision model. |
| Cloud and Turbo | Optionally queue H3 on Comfy Cloud; apply a four-step Turbo LoRA to local or cloud timeline generation. |
| Job tracking | View progress, failures, seeds, prompt IDs, GPU telemetry, downloadable API graphs, and job-specific cancellation. |
| Projects and portability | Manual Save/Save As, recovery copies, project ZIP import/export, complete library backups, and trusted-LAN access. |
| Film export | Download a sequenced MP4 or a ZIP of individual clips with a scene/prompt manifest. |

Frameforge is a generative, single-track editor. It does not provide a conventional multi-track compositor, transitions, titles, keyframes, or independent audio mixing. Audio references condition generation; exported video uses the main take’s soundtrack.

## Requirements

| Component | Required for |
| --- | --- |
| Python 3.10 or newer, with `pip` and `venv` | Running the editor service. |
| A modern browser | The editing interface; WebGL2 is needed for Set Studio. |
| Internet access on initial install | Downloading Python dependencies and the bundled FFmpeg package. |
| Disk space for media, models, and outputs | The portable library grows as you import, generate, and export media. Models are stored on the ComfyUI machine. |
| ComfyUI with the appropriate nodes and models | Local H3 generation, latent encoding, Speech Studio, Gaussian reconstruction, and Qwen image editing. |
| An OpenAI-compatible Chat Completions endpoint | Optional Scene Writer generation; a vision-capable model is needed for image input, Describe image, and Improve prompt. |
| Comfy Cloud account and API key | Optional cloud H3 generation, which consumes cloud credits. |

The editor and ComfyUI can run on different computers. GPU and memory requirements depend on the workflow, models, resolution, and duration; this repository does not establish one universal minimum GPU specification. Installing the editor’s Python dependencies does **not** install ComfyUI, its custom nodes, or model weights.

FFmpeg selection is: `FFMPEG_BINARY`, then a system `ffmpeg`, then the binary supplied by `imageio-ffmpeg`. No Node.js installation is needed to run the app; Node is only used for JavaScript development tests.

## Installation and launch

### 1. Get the application

Download/extract or clone this repository into a writable folder. Keep `editor/`, `static/`, `prompts/`, and `Work Flows/` together with `run.py`. Open a terminal in that folder for the commands below.

### 2. Start with the supplied launcher

**Windows:** double-click `start.bat`, or run it from Command Prompt:

```bat
start.bat
```

The Windows launcher expects the Python launcher command `py -3` to be available.

**macOS / Linux:**

```sh
./start.sh
```

If the executable permission was lost when extracting the files, use:

```sh
sh start.sh
```

The launcher creates `.venv` and installs `requirements.txt` on first launch. Open [Frameforge on this computer](http://127.0.0.1:8787). Keep the terminal running; press `Ctrl+C` there to stop the service.

### Manual installation

**Windows — Command Prompt:**

```bat
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe run.py
```

**macOS / Linux:**

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python run.py
```

These commands use the environment’s Python directly, so shell activation is unnecessary. If your Linux installation lacks `venv`, install the Python venv package supplied by your operating system, then repeat setup.

### Updating or repairing dependencies

Launchers reuse an existing environment; they do not reinstall dependencies on every start. After updating application files, or after an interrupted first installation, run the applicable dependency command again:

```sh
# macOS / Linux
.venv/bin/python -m pip install -r requirements.txt
```

```bat
REM Windows
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Back up the library before updating. Do not copy a virtual environment between operating systems; recreate it using the commands above.

### Startup options

Examples below assume the environment is activated; otherwise substitute the environment’s Python path shown above.

```sh
python run.py --port 8788
python run.py --data "/path/to/my-film-library"
python run.py --local-only
python run.py --lan
python run.py --host 192.168.1.20 --port 8787
```

| Option | Meaning |
| --- | --- |
| `--port` | Listening port; default `8787`. |
| `--data` | Library directory; default `data/` beside the application. Overrides `FRAMEFORGE_DATA`. |
| `--local-only` | Bind to localhost, overriding a saved LAN preference for this launch. |
| `--lan` | Bind to all IPv4 interfaces for trusted-LAN use. |
| `--host` | Bind to a specific interface; mutually exclusive with `--lan` and `--local-only`. |

On a fresh library the editor is local-only. Later launches honor the saved LAN preference unless overridden. Run only one editor service per library.

## First-time setup

### Connect local ComfyUI

1. Start ComfyUI and install the nodes/models needed for the workflows you intend to use.
2. Open **Settings** using the gear at the top right.
3. Replace **ComfyUI address** with the address reachable **from the editor host**. For the same computer, this is often `http://127.0.0.1:8188`; for a separate server, use that server’s LAN address. The repository’s initial `192.168.88.253` address is an example configuration, not an automatic discovery result.
4. Click **Test connection & discover models**.
5. Expand **Model filenames** and select or enter the exact filenames installed on that server.
6. Set the project dimensions and click **Save settings**.

The editor’s backend talks to ComfyUI. Browser CORS changes are not required. A successful connection check confirms connectivity, but does not prove every optional workflow’s dependencies are installed.

![Studio settings with LAN access, project dimensions, ComfyUI address, model discovery, and library backup](docs/screenshots/settings.png)

### Install the workflow dependencies you need

Use the supplied workflow files as the dependency reference on your ComfyUI installation. Resolve their missing nodes and models there before queuing the corresponding feature in Frameforge.

| Feature | Supplied workflow | Dependencies to check |
| --- | --- | --- |
| Local timeline generation and continuation | `Work Flows/Chain Motion Workflow.json` | Native MiniMax H3 reference nodes, Motion Context extension, H3 model, text encoder, video/audio VAEs, and latent load/save support. |
| Speech Studio | `Work Flows/LtX_2_3_Audio_References.json` | LTX 2.3 checkpoint, encoder, distilled LoRA, and audio-reference nodes. |
| Image → Gaussian splat | `Work Flows/World-single-image-Gaussian-Splat.json` | WorldMirror V2 dependencies, including `VNCCS_LoadWorldMirrorV2Model`, `VNCCS_WorldMirrorV2_3D`, `VNCCS_SavePLY`, and `VNCCS_BackgroundPreview`. |
| Qwen image editing | `Work Flows/Qwen_image_2.1_00071.json` | Qwen 2.1 workflow models and its custom nodes. |
| Turbo timeline generation | Applied by the editor | `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors`. |

The configurable default model filenames are:

| Setting | Default filename |
| --- | --- |
| H3 model | `minimax_h3_ref2va_pruned_int8_convrot.safetensors` |
| H3 text encoder | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` |
| H3 video VAE | `minimax_h3_video_vae_fp16.safetensors` |
| H3 audio VAE | `minimax_h3_audio_vae_fp32.safetensors` |
| LTX checkpoint | `ltx-2.3-22b-dev-fp8.safetensors` |
| LTX encoder | `gemma_3_12B_it_fp4_mixed.safetensors` |
| LTX distilled LoRA | `ltx-2.3-22b-distilled-lora-384-1.1.safetensors` |

These are the app’s defaults, not bundled model downloads. Qwen and WorldMirror settings come from their supplied workflows.

### Choose project resolution

Width and height are shared across the project and use multiples of 32. **Target megapixels → Apply MP** calculates dimensions while preserving the current aspect ratio; **Save settings** applies them. Matching resolution is necessary for reusable motion latents. Start with a resolution your ComfyUI machine can handle.

Language-model and cloud credentials have separate setup screens, described under [Scene Writer](#scene-writer) and [Cloud inference](#cloud-inference-and-turbo).

## Create your first sequence

1. Use the **＋** beside the project selector to create a project, or begin with the initial project.
2. Import an image, video, or audio file through **Asset library → Import**, or drop files into the library.
3. Select the first timeline segment. Enter a prompt under **Segment properties** and set **Delivered duration**.
4. Add references with **References → Add**, the library card’s **＋**, or by dropping assets onto the segment. Insert the displayed reference tags into your prompt when needed.
5. Open **Generation settings** to choose a seed, seed randomization, steps, and image reference size.
6. Click **Queue selected**, then inspect **Generation queue**. A completed take becomes the segment’s main video and remains in the library.
7. Add another segment. Enable **Continue the previous timeline segment**, or choose a source under **Latent motion continuation · source segment**. Enter the next prompt and queue it.
8. Preview the sequence, compare takes, adjust trims, and click **Save**.
9. Choose **Export film → Finished video** once every segment has a usable main video.

You can explore importing, editing, project management, Set Studio staging/rendering, and export of existing videos without submitting AI generation jobs.

## Editor and asset library

### Find your way around

| Section | Purpose |
| --- | --- |
| Top bar | Project selection, New project, Manage, Save, Save As, connection status, Settings, and Export film. |
| Workspace tabs | Editor, Scene Writer, Set Studio, Speech Studio, and Generation queue. |
| Asset library | Import, search, filter by type/folder, and inspect media. |
| Program monitor | Preview, playback/scrubbing, frame capture, and main-take selection. |
| Segment properties | Prompt, timing, continuity, references, generation settings, takes, and segment actions. Scroll this panel to reach lower sections. |
| Timeline | Scene organization, sequential segments, selection, generation controls, and zoom/scroll range. |

Drag panel dividers to resize the library, preview/properties area, timeline, and scene list. Sizes are remembered in the current browser. Double-click a divider to reset it, or focus it and use arrow keys.

### Import and organize assets

Imports are copied into the portable library. Filter by **All**, **Images**, **Video**, or **Audio**, and search names, folders, and tags. Open an asset to rename it, choose an existing folder or type a new one, and add comma-separated tags. Use **Save asset details** to retain edits. **Download original** retrieves the stored source.

For images, write an **Image description** yourself or click **Describe image**. Automatic descriptions use the vision-capable model configured in Scene Writer and save automatically. Review the description for accuracy.

![Image asset details with preview, folder and tag fields, and image-description controls](docs/screenshots/asset-details.png)

### Edit the timeline

All segments play sequentially on a single layer. Scenes organize prompts and shared references; they are not separate compositing tracks.

- Use **＋ Scene** and **＋ Segment** to add content. Scene settings also let you rename, move, or delete a scene.
- Drag a segment to reorder it or move it between scenes. Shift-click to select multiple segments for **Queue selected**.
- Drag either segment edge to change its duration, or enter **Delivered duration** in properties. Set **Source in point** to choose where the source video begins.
- Use **Duplicate** or **Delete segment** in properties. Undo/redo includes scene and segment deletion.
- Drop videos onto empty timeline space to create imported-video segments. Drop images, videos, or audio onto an existing segment to add references instead.
- Drag either end of the bottom range control to zoom; drag its center to scroll through the timeline.

### Preview, takes, and frame capture

Use the playback buttons, scrubber, or **Space** to play from the selected segment. Playback stops at a segment without a main video. **Capture frame** saves the current preview frame as an image asset.

Every newly generated result becomes the segment’s main take, resets its source in-point to zero, and normally adopts the result’s actual duration; duration edits made while a job runs are protected. Earlier takes remain available. Choose a main video using the monitor dropdown or **Generated takes → Use**, and download a take using its arrow. Rerolls use unique output directories, preserving earlier latent files.

## Prompts and references

### Full prompts and structured fields

Use **Full prompt** for freeform editing or **Structured fields** for the guide’s six sections:

| Field | What to describe |
| --- | --- |
| `subject_definitions` | Subjects and their actual reference sources. |
| `summary` | The requested generation task and concise scene summary. |
| `retention_analysis` | What should remain consistent with the references. |
| `detailed_description` | Action, composition, camera movement, internal cuts, and dialogue. |
| `overall_soundscape` | Ambience and physical sound effects. |
| `non_diegetic_music` | Background score, or `N/A` when absent. |

The fields include guide-based help. Switching views preserves the original prompt; legacy formats remain supported without automatic rewriting. **Open Scene Writer** in the segment inspector opens a candidate-writing flow for that particular segment.

### Add and number references

H3 supports up to **9 images, 3 videos, and 3 audio clips per segment**, counting shared scene references. Duplicate asset references count once. Extra dropped files remain in the library if reference capacity is full.

Use tags such as `<Picture 1>`, `<Video 1>`, and `<Audio 1>` exactly as shown in the reference list. The insert button places the corresponding tag into the prompt. Image reference cards can be dragged to reorder them; check the displayed numbering and prompt after editing references. Thumbnails also appear on timeline segments.

**Shared scene assets & settings** contains the scene-wide prompt and references. That prompt is prepended to each segment prompt, and shared assets apply throughout the scene. Remove shared references through scene settings.

Under **Generation settings**, **Image reference size** offers:

- **Match:** scale references down to the generation’s pixel area.
- **Max:** use a 2048-pixel short edge for finer identity detail; this can be considerably slower.

### Trim reference audio

Open an audio asset to preview it, enter trim-in/out points, preview the selection, and **Save trimmed copy**. The original recording is retained.

For a reference used by a particular segment, its audio trim control opens a waveform with **IN/OUT** handles and numeric fields. Choose **Apply to segment** to use that excerpt only for this segment, including when the audio asset is shared by its scene. **Use full clip** resets the selection. Local and cloud generation use the selected excerpt; the source asset is unchanged.

### Seeds and sampling

Enter a fixed seed to repeat an input configuration, click **Randomize** for a new visible seed, or enable **Randomize each generation** for a fresh seed per queued generation. Segment choices persist with the project; Speech Studio choices stay in its draft. Jobs record the actual seed. The normal step count comes from segment settings; [Turbo](#cloud-inference-and-turbo) overrides new timeline jobs to four steps.

## Motion continuity and timing

### Link segments

Under **Motion continuity**, choose **Latent motion continuation · source segment** to link another segment, including one in another scene. **Continue the previous timeline segment** is a shortcut. Choose **No segment link** to disconnect an explicit link, and clear the previous-segment option if enabled. The imported/saved-take selector can supply an explicit video source instead.

When source and continuation are queued together, dependencies generate first regardless of timeline position. If only the continuation is queued, it uses the source’s current main take. Circular links are rejected. Failed or cancelled predecessor jobs prevent their dependent generations from proceeding.

![Segment properties scrolled to timing and motion continuity controls](docs/screenshots/continuity.png)

### Continue an imported or edited video

1. Open a video asset and choose **Add to timeline**, or drop it into empty timeline space.
2. Set its source in point and delivered duration.
3. Choose **Encode segment latents** if you want to encode explicitly, then **Continue** to add a continuation segment.
4. Write the continuation prompt and queue it. Required source encoding is also queued automatically; matching active encodings are reused.

Local encoding normalizes the source to the project resolution and 24 fps, adding silent audio if required. Changing its source, trim, duration, resolution, or ComfyUI server can invalidate a saved encoding. The app queues a fresh encoding when needed. Use the full generated take for a direct latent join; an edited take needs an encoding of the edited footage to avoid skipping motion at the join.

### Understand overlap and duration

Choose **22**, **39**, or **56** context frames. These frames condition the beginning of the next shot and are removed from both its video and audio before saving. They are not crossfades on the final timeline.

H3 generates `5 + 17k` frames at **24 fps**, rounding upward to the next supported length:

| Request | Generated frames | Delivered footage |
| --- | --- | --- |
| First shot, 3.5 seconds | 90 | 90 frames / 3.75 seconds |
| Continued shot, 3 seconds, 22-frame context | 107 | 85 frames / about 3.54 seconds |

Local latent files must match the generation resolution and retain their originating ComfyUI server association. Cloud continuation instead uses the source video’s tail, as described below.

## Scene Writer

### Configure the language model

Open **Scene writer → Language model connection**. Enter an OpenAI-compatible Chat Completions endpoint, model name, and API key if the server needs one. A base URL such as `http://localhost:1234/v1` or the full `/chat/completions` URL is accepted.

Use **Discover models** to query the endpoint’s `/models` route, select a model, and **Save connection**. Manual model entry works when discovery is unsupported. A listed model is not necessarily vision-capable.

Leave **Output token limit** blank to use the endpoint’s response-length setting, or enter an explicit override. The model’s context window still limits input plus output. Requests are non-streaming and may take up to 15 minutes. In LAN use, `localhost` refers to the editor host, not the viewing device.

![Scene Writer language-model connection fields and optional output token limit](docs/screenshots/scene-writer-connection.png)

### Write and approve a scene

1. Name the scene and describe its action, mood, characters, and dialogue.
2. Select or import up to nine image references. Optionally expand **Character sheet and continuity**; **Use last scene’s continuity** carries context forward.
3. Click **Write script candidate**, or paste a script directly without connecting a model.
4. Review/edit the candidate, then click **Check required sections & preview**.
5. Set seconds per shot, overlap, and whether shots should connect.
6. Click **Approve script & create scene**. Approval adds the scene and segments; video generation is queued separately from the timeline.

![Scene Writer with scene brief, references, editable script, and validation control](docs/screenshots/scene-writer.png)

Current scripts use numbered `[SEGMENT n]` blocks with the six full-reference fields listed above. Each block becomes one timeline segment; internal `[Shot N]` cuts stay inside that segment’s description. A single complete six-section prompt is also accepted. Selected images are copied into each segment’s own reference list so they can be edited independently. Approved scripts and carryover context are retained in the project.

Legacy SceneCreator scripts with `[SHOT n]`, dialogue, sound, continuity, and scene-ending blocks are still accepted. Validation checks required structure, not cinematic quality or factual/character consistency. Invalid candidates remain editable and cannot be approved. Unapproved drafts stay in the current browser per project.

### Rewrite an existing segment

Use **Segment properties → Open Scene Writer**, review the candidate, and choose **Approve & update segment**. Approval replaces that segment’s prompt and image references while keeping its duration, takes, audio/video references, and motion links. This differs from the top-level Scene Writer flow, which creates a new scene.

### Data sent to the model

The scene brief and selected images are sent to your configured endpoint. Images are converted to JPEG with a maximum side length of 1280 pixels. Connection settings are shared by editor clients. API keys live in `data/llm-config.json`, are not returned by the configuration API, and are excluded from project/library exports. Changing endpoints clears the old key unless a replacement is supplied. Discovery itself does not send scene content or save credentials.

## Speech Studio

Speech Studio uses the supplied **local LTX 2.3 audio-reference workflow** to generate speech after a short voice prefix.

1. Import an image and a **1–2 second** voice recording. Trim the reference first if needed.
2. Open **Speech studio**, enter an output name, and choose the driving image and voice prefix.
3. Describe the performance and dialogue that should follow the reference.
4. Set a total generation length **longer than the reference** and choose a seed/randomization setting.
5. Click **Queue speech**. Listen to the result before adding it as a segment reference.

![Speech Studio driving image, voice prefix, dialogue prompt, duration, and seed controls](docs/screenshots/speech-studio.png)

A 4-second generation with a 1.5-second prefix produces a **2.5-second finished audio asset**. The interface shows this calculation. The prefix and extra generation-grid padding are removed from both the sound and a small **32 × 32** driving video.

The workflow locks the short reference at the beginning of a full-duration AV latent and generates the remaining audio. It retains the supplied first sampling schedule, omits the spatial upscaler/second pass for the small driving video, and needs no speaker-ID LoRA. Words and voice consistency remain generative and require listening review. Audio is a generation reference, not an independently mixed timeline soundtrack.

## Set Studio

Open **Set Studio** from the workspace tabs. It is a separate 3D workspace for making image references. Use **Save set** to retain objects, poses, attachments, cameras, colors, and image-edit settings. **Save as…** copies the current set, including unsaved changes, under another name; media assets are reused. Saved sets are included in full-library backups.

![Set Studio with a bundled mannequin, navigation tools, scene reconstruction, and object/hand properties](docs/screenshots/set-studio.png)

### Reconstruct a scene from an image

1. Import an image into the main asset library.
2. Select it under **Scene reconstruction** and click **Image → Gaussian splat**.
3. Follow progress in Set Studio or the main generation queue. This runs WorldMirror V2 on **local ComfyUI**.
4. Keep Set Studio open to see the completed reconstruction appear automatically. For an earlier result, use **Show in viewport** on its job or select a saved splat and click **Show splat in viewport**.
5. Select the object, **Frame object**, then adjust its placement with handles or numeric properties.

Existing Gaussian PLY files can be imported; ordinary point-cloud PLY files are rejected. Re-showing a splat focuses the existing object instead of duplicating it. Splat scaling is uniform. WorldMirror results start with a 180° X rotation to convert their camera coordinates; adjust if needed.

Single-image reconstruction approximates visible surfaces and may have holes behind unseen areas. Set Studio positions splats; it does not sculpt or repaint individual Gaussians. The supplied reconstruction workflow’s model/GPU requirements still apply.

### Stage and pose mannequins

Click **＋ Mannequin** to add the bundled rigged Quaternius humanoid. Each instance has its own color, transforms, and pose.

- Select the mannequin’s root in the object list to place or scale the whole figure. Double-click a mannequin surface to select the whole model and switch to Move.
- Single-click a visible body part, or select its joint in the list, then use **Rotate** handles or numeric degrees. Child joints and attached props follow.
- Use **Neutral pose** or **T pose** as starting points.
- Enable **IK pose**, select an arm or leg, and move its hand/foot target. The shoulder/elbow or hip/knee follows without moving the root or stretching bones. Unreachable targets stop at the limb’s reach.
- Expand **Left hand** or **Right hand**. **Whole hand grasp** sets all fingers from 0% open to 100% closed; individual finger sliders refine the pose. The grasp readout reflects their average.

Posing supports Undo and Save set. Finger poses are independent of wrist rotation, arm IK, and body presets. Existing legacy block mannequins retain their original poses but do not have finger bones. IK is limb-based, not full-body or collision-aware. Selection highlights and editing handles are omitted from renders.

### Add primitives, imported models, and attachments

Use **＋ Primitive** for boxes, spheres, or cylinders. In Object properties, **Attach to mannequin** and **Body part** attach props to a joint. Their local transforms then follow the pose.

**Objects → Import GLB model** accepts self-contained **GLB 2.0 files up to 256 MB**, including embedded textures. Imports appear in the viewport and remain in the **Imported models** library for reuse. Move, rotate, scale, rename, or delete a scene instance, then save the set.

For imported models:

- Export without Draco, Meshopt, or KTX2 compression.
- Original materials appear in both viewport and renders. **Show textures** toggles texture maps per instance while keeping material colors; the choice supports Undo and saving.
- **Attach to mannequin** snaps the model origin to a joint while preserving visible size and orientation. Adjust the local transform to fit. **None · world** detaches without moving it.
- Embedded animation clips are not played. Generic GLB imports do not acquire the mannequin’s posing controls.

### Save camera views and render images

Orbit by dragging, pan with right-drag, and zoom with the wheel. Use **Camera from view** to save a viewpoint; cameras have position, rotation, and field-of-view controls. **Look through camera** previews the output aspect ratio; **Free view** returns to navigation. Multiple cameras can be saved.

Choose the render camera or current view, output dimensions (**64–4096 pixels per side**), background color, and optional transparency. **Render to image assets** saves a PNG into the main library; **Download PNG** saves a standalone copy. Mannequins, splats, props, and imported models are included; grid and editing handles are hidden.

The viewport requires WebGL2. Three.js, Spark, and the mannequin loader/model are bundled locally with no runtime CDN dependency.

### Qwen image editing

Under the render controls, **Qwen image editor** transforms the camera render through local ComfyUI.

1. Compose the camera and set output dimensions. Its render becomes **image 1**.
2. Drop/browse reference images or choose images from the asset library. Up to nine extra images become **images 2–10** in displayed order.
3. Describe the final image in **Editing prompt**. Optionally use **Improve prompt**, which sends the render and references to the vision-capable model configured in Scene Writer. Review the replacement; **Undo rewrite** restores the original.
4. Choose a seed or automatic randomization and click **Render & queue image edit**.
5. Follow progress/errors or cancel below the prompt. A finished image is saved to the asset library and shown over the viewport. Use **Back to 3D scene**, **Show result**, or **Download image** as needed.

![Qwen image editor beside the staged scene, showing reference inputs and editing prompt](docs/screenshots/qwen-image-editor.png)

Queued requests snapshot their inputs. Later set edits do not alter a queued job. **Save set** retains prompts, reference IDs, and seed preferences.

The editor expands the supplied Qwen subgraph with 25 steps, CFG 1, Euler/simple sampling, reference encoding, caching, decoding, and PNG output. Reference resolution is set to 0 to preserve the camera render dimensions, rounded to multiples of 32. Example images/prompts and comparison-preview nodes are replaced by your inputs. Improve prompt uses `prompts/EditPromptEnhancer.txt` and does not change render dimensions.

## Cloud inference and Turbo

Open **Cloud setup** beside **Queue selected**, enter a Comfy API key, **Save key**, and **Test connection**. Enable **Cloud inference** for newly queued timeline generations; disable it for local generation. The cloud toggle starts off after page reload, and each queued job retains its destination.

![Comfy Cloud setup dialog with key entry, save, and connection test](docs/screenshots/cloud-setup.png)

| Behavior | Local H3 | Cloud H3 |
| --- | --- | --- |
| Initial shot | H3 reference generation with local Motion Context workflow | Native H3 reference generation |
| Continuation | Saved latent, or automatic encoding of the source clip | H3 Add Guide using the source video’s last 22/39/56 frames and matching audio |
| Imported video source | Encoded when necessary | Uses the video tail directly |
| Saved continuation data | Video plus H3 latent files | Video/audio; no custom H3 latent file |
| Speech, standalone encoding, reconstruction, Qwen | Use local ComfyUI | Not switched to cloud by this toggle |

Cloud respects source in points and segment durations, trims the overlap prefix from downloaded video/audio, and uses the actual preceding job’s output when queuing linked shots together. Short source videos fail clearly. Returning to local continuation uses automatic encoding when a matching latent is unavailable.

To compare results, disable automatic seed randomization and use the same prompt, seed, references, resolution, duration, and steps. Keep the same source take for continuation comparisons. Both takes remain available; cloud results are labeled **Cloud Add Guide take**. Matching seeds do not guarantee matching images across different workflows.

**Turbo** applies `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors` at strength 1.0 and uses four sampling steps for newly queued timeline generations. It works with local and cloud inference, preserving the configured base model. Turning it off restores normal step settings for future jobs. Existing jobs and saved segment settings are unchanged.

Cloud sends prompts and reference media to the account and consumes credits. Its key is stored separately in `data/comfy-cloud.json` with owner-only permissions and excluded from jobs/library exports; signed download hosts do not receive the key. The repository’s validation record does not establish completed live cloud execution or comparative visual quality; treat cloud as a preview integration. See the [cloud graph notes](Work%20Flows/Cloud/README.md).

## Generation queue

Open **Generation queue** to inspect active and completed jobs. Queueing keeps you in the current editor view; the queue count highlights pending work.

![Generation queue in an idle demonstration library](docs/screenshots/generation-queue.png)

Job entries show status, current stage/node, sampler progress, elapsed time, actual seed, ComfyUI prompt ID, errors, and result links. Available local GPU telemetry appears above the list. Progress represents sampling stages; model loading does not have a reliable percentage.

The editor’s durable queue submits one generation at a time. ComfyUI’s shared queue remains authoritative. History polling can recover results after temporary disconnections or editor restarts. Jobs with uncertain submission state are not blindly resubmitted.

**Cancel job** removes that job’s pending prompt or targets its running prompt when supported. It does not clear the entire ComfyUI queue. Local dependent jobs cancelled before submission never reach ComfyUI. Targeted running cancellation requires compatible `prompt_id` interruption support on the server.

Submitted API graphs are stored under `data/graphs/` and can be downloaded via **Workflow JSON**. They are executable API-format graphs derived from the supplied workflows, not UI-format graphs with reroutes, counters, and widget-only nodes. These graphs are useful when diagnosing missing nodes or models.

## Save, recover, and manage projects

**Save** (`Ctrl/Cmd+S`) finalizes the current project. An asterisk means there are changes since the last manual save. **Save As** (`Ctrl/Cmd+Shift+S`) creates a named independent project copy; media assets remain shared in the library.

Background updates protect a separate recovery copy on the editor host, with pending edits also retained in the browser. Queuing generation and approving scripts update the working copy without silently replacing the finalized version.

When reopening unfinished work, choose **Recover work** or **Use last saved version**. **Manage → Return to saved version** opens the same choice. Finish or cancel active jobs before reverting. Existing projects become the initial saved baseline when upgrading.

![Recovery dialog offering unfinished work or the last saved version](docs/screenshots/recovery.png)

**Manage**, beside the project selector, provides Rename, Export project, Import project, Return to saved version, and Delete project.

![Saved-project management controls](docs/screenshots/projects.png)

Project ZIP archives include referenced media, generated takes, and local latents. Imports create a separate project with new IDs and retain its continuation links. Deleting a project keeps its media in the library and is blocked while project jobs are active. Use a complete library backup to move the whole workspace, including sets.

## Export your film

Click **Export film** and choose:

| Export | Contents |
| --- | --- |
| **Finished video** | One MP4 containing scenes/segments in timeline order. |
| **Individual clips** | A ZIP of numbered, trimmed MP4 clips with a scene/prompt manifest. |

![Export dialog showing both formats and a missing-main-video diagnostic](docs/screenshots/export.png)

Export normalizes clips to the project resolution and **24 fps**, with **H.264 video and AAC audio**. Source in points and requested timeline durations are respected. Context prefixes have already been removed during generation.

Every segment needs a usable main video. If an earlier take is shorter than the segment’s requested duration, export uses its available footage without padding, and the dialog reflects the shorter film length. Missing files or in-points beyond a source’s end still require correction. Find the completed export’s download link in the generation queue.

## LAN access

In **Settings → LAN access**, enable sharing to other devices on the same trusted network. The change applies immediately without restarting generation workers, and `data/hosting.json` remembers it. The settings screen displays LAN addresses.

Alternatively, start with `start-lan.bat`, `./start-lan.sh`, or:

```sh
python run.py --lan
```

Stop any editor already using that library before launching another process. On another device, open `http://<editor-host-LAN-IP>:8787` using the editor computer’s address, not the ComfyUI server’s address. Keep the editor computer and process running.

LAN mode has **no sign-in**. Connected users share the library, projects, and queue; avoid simultaneous editing of the same project. Use a trusted network without internet port forwarding. If access fails, check the host’s private-network firewall for the selected TCP port and the router’s Wi-Fi client isolation.

Disable **LAN access** to return to local use. Remote clients disconnect; continue on the host’s local address. `--local-only` overrides a remembered LAN setting at launch. `--host <LAN-IP>` binds to one specific interface.

## Backup and moving your library

### Complete library backup

1. Open **Settings → Download complete library backup**.
2. Keep the ZIP in your backup location.
3. To restore, extract it into a new folder so `library.json` and the asset folders are directly inside that folder.
4. Start the editor with `--data` pointing to the extracted folder.

```sh
python run.py --data "/path/to/restored-library"
```

The backup contains library/project records, sets, imported and generated assets, downloaded latents, and saved API graphs. Media paths are relative. LLM/cloud credential files and the hosting preference are separate from this portable export; configure those connections again after moving. Install the application and dependencies separately, preserving its `Work Flows/` and `prompts/` directories.

### Moving ComfyUI and latent files

Local H3 latents are stored on ComfyUI at `output/frameforge/<job-id>/latent_00001.safetensors` and copied into the editor library as `latents/<job-id>.safetensors` when downloaded.

Moving only the editor while keeping the same ComfyUI server needs no latent-path changes. Moving ComfyUI requires restoring those files at their original output-relative locations and retaining its URL, or re-encoding the local source videos on the new server. Stale server associations are rejected rather than silently loading unrelated files.

## Keyboard and mouse controls

| Control | Action |
| --- | --- |
| `Space` | Play/pause the timeline from the selected segment. |
| `Ctrl/Cmd+S` | Save project. |
| `Ctrl/Cmd+Shift+S` | Save As. |
| `Ctrl/Cmd+Z` | Undo a project edit. |
| `Ctrl/Cmd+Shift+Z` | Redo a project edit. |
| Shift-click segment | Add/remove it from a multiple selection. |
| Drag segment / its edge | Reorder/move / change duration. |
| Drag timeline range ends / center | Zoom / scroll the timeline. |
| Drag divider / double-click divider | Resize panel / reset its size. |
| Arrow keys on focused divider | Adjust panel size. |
| Arrow keys on audio trim handle | Adjust the selected in/out point; Shift uses larger steps. |
| Set Studio drag / right-drag / wheel | Orbit / pan / zoom. |
| Click mannequin limb / double-click model | Select joint / select whole model for movement. |

Editor playback and undo shortcuts are suppressed while typing in fields or using a modal dialog. Set Studio has its own Undo button and Save set controls.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Launcher closes or dependencies are missing | Run it from a terminal to read the error. Confirm Python 3.10+, `pip`, and `venv`; rerun the explicit dependency installation command. |
| Editor address will not open | Keep the server terminal running, check its printed address/port, and resolve a port conflict with `--port`. |
| ComfyUI offline | Verify ComfyUI is running and the configured URL is reachable from the editor host. Replace the repository’s example address. |
| Connection works but generation fails | Inspect the job error and downloadable graph; check the required nodes and exact model filenames for that feature. |
| GPU memory exhausted or generation slow | Reduce resolution/duration and use Match reference size. Check the selected workflow/model requirements and other work in ComfyUI’s queue. |
| Continuation reports stale/missing latent | Verify the source main take, trim, resolution, and server URL. Re-encode the segment on the current server. |
| Continuation cannot use a short clip | The source must supply the chosen context frames; choose a longer source or smaller supported overlap. |
| Speech output is shorter than total duration | The voice prefix is subtracted. Choose a total length longer than the reference. |
| Script cannot be approved | Read the missing-section error, edit the candidate, and check it again. For current prompts, include all six structured fields in each segment. |
| Model discovery fails | Confirm the endpoint and optional key. Enter the exact model name manually if the endpoint lacks `/models`. |
| Image descriptions or prompt improvement fail | Select a vision-capable model in Scene Writer and verify that endpoint accepts image inputs. |
| Set Studio is blank | Check browser WebGL2 support and graphics acceleration. The status line reports renderer/model errors. |
| Splat does not appear | Use Show splat in viewport and Frame object; check the completed reconstruction job and WorldMirror dependencies. |
| GLB import is rejected | Use a self-contained GLB 2.0 file at or below 256 MB without Draco, Meshopt, or KTX2 compression. |
| Export reports missing video | Choose a main take for each segment, and ensure in-points are inside source footage. |
| FFmpeg unavailable | Reinstall requirements, provide system FFmpeg, or set `FFMPEG_BINARY` to a working executable. |
| Another device cannot connect | Enable LAN mode, use the editor host IP, and check private-network firewall/client-isolation settings. |
| Save conflict from another client | Preserve your draft and reload/recover as appropriate. Avoid concurrent edits to the same project. |

See [VALIDATION.md](VALIDATION.md) for recorded automated/live checks and practical limits. Screenshots in this guide demonstrate controls, not successful execution of every external AI workflow.

## Development and workflow sources

The app uses FastAPI/Uvicorn, a plain JavaScript browser frontend, Pillow, and FFmpeg. Application source is in `editor/` and `static/`; prompt guides are in `prompts/`; tests are in `tests/`.

Run Python tests with the virtual environment’s Python:

```sh
python -m unittest discover -s tests -v
```

JavaScript tests are individual `tests/test_*.mjs` scripts run with Node. Tests that import Three.js use the supplied loader, for example:

```sh
node --experimental-loader ./tests/three-loader.mjs tests/test_rigged_mannequin.mjs
```

`tests/integration_local.py` exercises a running editor using named `test-clip` and `test-audio` fixtures. It creates validation projects/assets and checks trims, frame capture, byte-range playback, save conflicts, and both export formats without submitting ComfyUI jobs. Use a separate test library. Consult the script and [validation record](VALIDATION.md) before running it against an existing library.

Workflow provenance:

- `Work Flows/Chain Motion Workflow.json`: H3 reference conditioning, sampling, motion latent loading/saving, and video/audio context trimming.
- `Work Flows/LtX_2_3_Audio_References.json`: LTX checkpoint, encoder, distilled schedule, image conditioning, and locked audio reference.
- `Work Flows/World-single-image-Gaussian-Splat.json`: WorldMirror V2 scene reconstruction.
- `Work Flows/Qwen_image_2.1_00071.json`: Qwen image-edit pipeline.
- `Work Flows/Cloud/`: API-format first-shot and Add Guide continuation examples; see its [README](Work%20Flows/Cloud/README.md).

The bundled Quaternius mannequin’s attribution and licensing are recorded in [static/models/quaternius/README.md](static/models/quaternius/README.md). General external character-rig import and playback of imported GLB animations are not included.

Documentation images live in [docs/screenshots](docs/screenshots). See the [screenshot notes](docs/screenshots/README.md) for capture context and maintenance guidance.
