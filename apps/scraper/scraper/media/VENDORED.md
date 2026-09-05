# `gemini_media.py` is a vendored copy — do not edit it here

Source: `3d_framework_glass_try-on/services/inference/gemini_media.py`
Copied: 2026-09-05
sha256: `5d373cf4f4516764e257e9936b02206f3b7a67678c5e6e881eed97359b8acc43`
Lines: 553

## Why a copy and not a rewrite

The module is 553 lines whose only third-party dependency is `requests`, and what
it really carries is a set of contract traps already paid for against the live
API:

- Veo rejects `inlineData` on some models even though Google's own REST example
  shows it; the module tries `bytesBase64Encoded` first and falls back
  (`VIDEO_IMAGE_SHAPES`). A 403 or 404 is **not** retried, so a bad key surfaces
  as a bad key instead of three identical failures.
- The video download URI needs the `x-goog-api-key` header too — without it the
  URI answers with an error page rather than the file.
- `negativePrompt` is a Vertex AI field this endpoint does not document, so it is
  offered and withdrawn rather than assumed.
- Veo 3.x renders audio in the same pass and `generateAudio` is unsupported here;
  the only lever is the prompt (`NO_VOICEOVER_GUARD`).
- One request per view, not one for four — which is what makes a bad angle
  retryable and reportable on its own.
- Gemini authenticates with `x-goog-api-key`, never `Bearer`.

Rewriting the calls would throw all of that away and rediscover it one failed
run at a time.

## Rules

1. **Never edit this file in place.** Fix it upstream and re-copy.
2. **Re-copying changes the hash above.** Update it in the same commit, so a
   silent drift between the two copies is impossible to miss in review.
3. `runner.py` calls only the two public functions, `generate_views` and
   `generate_video`. It does not import anything underscore-prefixed: the
   original plan did, to split the video call into submit/poll, and moving the
   executor into a foreground CLI removed the need — a script can simply block
   for fifteen minutes.

## Verifying the copy

```bash
sha256sum apps/scraper/scraper/media/gemini_media.py
# must match the hash above; if it does not, someone edited the copy
```
