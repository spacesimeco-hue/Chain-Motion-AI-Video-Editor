# Frameforge

A local video editor built around scene-based ComfyUI generation using Minimax H3. Organizes local media references, and projects, in a video editor that allows easy generation of long continuous AI generated videos. The editor also includes a voice clip creator powered by LTX 2.3 for creating dynamic sounding voice clips from voice references.

## Start

Requires Python 3.10+ (3.11 or 3.12 recommended).

- **Windows:** run `start.bat`.
- **macOS / Linux:** run `./start.sh`.
- Open **http://127.0.0.1:8787**.

The launcher creates a virtual environment and installs dependencies on first launch. FFmpeg is supplied by `imageio-ffmpeg`; an existing system FFmpeg or `FFMPEG_BINARY` takes precedence. First launch needs an internet connection to install these packages. Subsequent launches use the installed environment.

Manual setup:

```sh
python -m venv .venv
# Activate .venv for your OS, then:
python -m pip install -r requirements.txt
python run.py
```

Change the port or library location:

```sh
python run.py --port 8787 --data /path/to/my-film-library
```

The default library is `data/` beside the application. The server listens only on loopback by default. The browser talks to this local service, which talks to ComfyUI; ComfyUI does not need browser CORS changes. Run one editor service per library. This is a local, single-user application; it does not provide authentication for internet hosting.

## Editing workflow

1. Open **Settings**, enter your ComfyUI URL(ie. localhost:8188, ect), and use **Test connection & discover models**. Model filenames are editable with suggestions from the connected installation.
2. Import images, videos, or audio. Click assets to rename them, assign a folder, and add tags. Search across all three fields. Every import is copied into the portable library.
3. Add scenes, then segments. Scene settings contain a common prompt and shared references. Shared references apply to every segment in that scene.
4. Write a segment prompt, add references, and set its duration. Drag either segment edge to adjust its length, or enter the value in properties. Drag segments to reorder them or move them between scenes. Shift-click segments to select a batch.
5. Use references such as `<Picture 1>`, `<Video 1>`, and `<Audio 1>` in H3 prompts. The reference list shows the numbering. The little insert button adds the appropriate tag to the prompt. Limits are **9 images, 3 videos, 3 audio clips**, including shared scene references; duplicate references count once.
6. Enable **Continue the previous segment** and select **22, 39, or 56 frames** of motion context. The first segment of a scene starts a new chain unless an explicit continuation video is selected. **Queue scene** queues all its segments in order. Dependent segments wait for their predecessor's saved latent. A failed or cancelled predecessor stops its dependent generation with a clear error.
7. Generated videos become assets and takes on their originating segment. Every newly generated result becomes its main video, with its full duration and source in-point reset to zero. Choose another main take from the viewer dropdown or the take list. Rerolls have unique output directories; earlier latents are never overwritten.
8. Use **Capture frame** on the preview to save an image reference. For an imported video, open its asset details and choose **Add to timeline**, or drag it onto empty space in a scene’s timeline. Set its source in point and duration, then choose **Encode segment latents** and **Continue** in the inspector. Write the continuation prompt and queue it. **Queue scene** can encode the imported segment and generate its continuation in order. Encoding normalizes the media to the project resolution and 24 fps, adding a silent audio track when needed.
9. Choose **Finished video** for a sequenced MP4, or **Individual clips** for a ZIP of numbered MP4s plus a scene/prompt manifest. Exports honor source in points and timeline duration, normalize size/audio, and fail explicitly on missing or too-short main clips.

Undo/redo applies to project edits, including scene/segment deletion. `Space` plays the timeline from the selected segment, `Ctrl/Cmd+Z` undoes, `Ctrl/Cmd+Shift+Z` redoes, and `Ctrl/Cmd+S` saves. Playback stops when it reaches a segment without a main video.

## Duration and continuity

H3 generates `5 + 17k` frames at 24 fps. Connected shots reuse context frames at the front, then remove those frames and the matching audio before saving their video. These are **context overlaps**, not crossfades on the final timeline.

A requested duration is rounded upward to the next supported generation length. For example, a first 3.5-second shot generates 90 frames (3.75 seconds); a continued 3-second shot with 22 context frames generates 107 frames and delivers 85 frames (about 3.54 seconds). The first selected generated take updates the segment's duration to its actual duration unless the user has edited the duration while the job was running.

Use the full generated take when continuing directly from its latent. Trimming its end and then using the untrimmed latent would skip motion at the join, so the editor automatically queues a fresh encoding of the edited segment before generating its continuation. To continue an edited clip, choose **Encode segment latents** after setting its source in point and duration. Changing the source, trim, duration, or project resolution invalidates that segment encoding until you encode it again. Latents must match the generation resolution and currently retain their originating ComfyUI server association.

## Speech studio: short voice prefix, longer generation

Speech studio uses the supplied LTX 2.3 audio-reference workflow with a **32 × 32** driving video. Choose an image, a **1–2 second voice reference**, a text prompt describing the dialogue/performance that follows, and a total generation duration longer than the reference.

The graph first creates a full-duration empty AV latent. It replaces the audio stream with the encoded, zero-noise-masked short reference. Native `LTXVConcatAVLatent` fits that reference into the full stream: the reference prefix stays locked, while the padded tail has noise mask 1 and is generated. The first sampling schedule from the supplied workflow is retained; the expensive spatial upscaler/second pass is omitted for this 32-pixel task. No speaker ID LoRA is required.

After decoding, the reference duration is trimmed from the beginning of **both** the sound file and the driving video. Extra generation-grid padding is trimmed from the end. For example, a 4-second generation with a 1.5-second reference produces a 2.5-second finished audio asset. The UI shows this calculation before submission. Words and voice consistency remain generative and need listening review.

Open any audio asset to preview it, set trim in/out points, preview the selection, and save a trimmed copy. This works for voice references and finished outputs. Add a finished audio asset as a segment reference. References condition the generator; they are not separately mixed timeline tracks. Video export uses the main video's soundtrack.

## Jobs and telemetry

The local durable queue submits one generation at a time, which limits peak load on consumer hardware. ComfyUI's own shared queue remains authoritative. The job panel shows job state, current node, sampler progress, elapsed time, ComfyUI prompt ID, failures, and GPU memory. Progress is per sampling stage; model loading has no invented percentage. History polling recovers results after temporary disconnections and editor restarts.

Cancellation deletes only the job's own pending prompt and uses targeted interruption if that exact prompt is running. It never clears the entire ComfyUI queue. A locally cancelled dependent job is not sent to ComfyUI. ComfyUI must support targeted `prompt_id` interruption (verified against the supplied server). Jobs with uncertain submission state are never blindly resubmitted.

Each submitted API graph is saved under `data/graphs/` and is downloadable from its queue entry. These are executable API-format graphs, built from the supplied workflows and verified against `/object_info`; UI-only counters, reroutes, and subgraph widgets are not sent to the server.

## Portability and backup

**Settings → Download complete library backup** creates a ZIP containing projects, imported and generated assets, downloaded latents, and saved API graphs. Extract it into a new folder and run the editor with `--data` pointing to that folder. Media paths in the library are relative. Keep the original `Work Flows/` files with the application as provenance.

Latents are saved on ComfyUI under `output/frameforge/<job-id>/latent_00001.safetensors` and copied locally to `data/latents/<job-id>.safetensors`. Moving the editor to another computer while keeping the same ComfyUI server needs no latent changes. Moving ComfyUI itself requires restoring those files to their original output-relative locations and retaining its URL, or re-encoding the local video on the new server. The editor rejects stale references to another server instead of silently loading unrelated files.

## Validation

```sh
python -m unittest discover -s tests -v
```

Core tests cover frame-grid math, reference limits and deduplication, graph wiring, independent reroll paths, speech prefix masking and output trimming, restart recovery, filesystem path safety, and cancellation ownership.

`tests/integration_local.py` exercises a running local editor with the named `test-clip` and `test-audio` fixtures. It deliberately creates validation projects/assets and checks trimming, frame capture, byte-range playback, optimistic save conflicts, and both export formats. It does **not** submit ComfyUI jobs.

See `VALIDATION.md` for actual live test results and outstanding constraints. The app implements this generative editing workflow; it is not a substitute for a conventional multi-track compositor with effects, transitions, titles, keyframes, or independent audio mixing.

## Workflow sources

- `Work Flows/Chain Motion Workflow.json`: supplied H3 reference conditioning, sampling, latent load/save, and matching video/audio context trim.
- `Work Flows/LtX_2_3_Audio_References.json`: supplied LTX checkpoint, encoder, distilled sampling schedule, image conditioning, and locked audio latent.
- [ComfyUI MiniMax H3 nodes](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_minimax_h3.py)
- [ComfyUI LTX nodes](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_lt.py)
- [H3 motion context implementation](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Contex-Loop)

Drag files from your computer into the asset library to import them. Drag the dividers between the library, preview, properties, timeline, and scene list to resize your workspace. Sizes are remembered in this browser; double-click a divider to reset it. Focus a divider and use arrow keys for small adjustments.

Drop videos from your computer or the asset library onto empty timeline space to add segments. Drop images, videos, or audio onto an existing segment to add references (9 images, 3 videos, 3 audio, including shared scene assets). Files exceeding capacity remain in the library. The asset library spans the full workspace height, with the timeline on its right.

Queueing a continuation automatically adds any required source encoding ahead of it. Matching active encodings are reused; stale trims, resolutions, or server associations trigger a fresh encoding. Previous takes remain available when a new take becomes main.

Use **Randomize** beside the seed in segment Generation settings or Speech studio to choose a new seed. The number stays visible and editable, and remains fixed until changed again. Segment seed changes save with the project; speech seeds stay in the current speech draft.

Enable **Randomize each generation** in segment Generation settings or Speech studio for a fresh seed on every queued generation. Segment preferences save with the project; speech preferences stay in its current draft. Disable the toggle to use the entered seed. Each job records its actual seed in the queue details and workflow.
