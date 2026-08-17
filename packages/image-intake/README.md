# @pulse/image-intake

Turning a file a stranger uploaded into an image you are willing to store.

The contract in one line: whatever comes in, exactly one kind of thing goes out —
a square WebP with no metadata. There is no passthrough path, which is the point.
A crafted file cannot survive as itself, and there is no "trusted" input type,
because the declared MIME and the file extension are both attacker-controlled and
neither is consulted.

Depends on [`sharp`](https://sharp.pixelplumbing.com/). Node 20+.

```ts
import { createImageIntake, ImageIntakeError } from "@pulse/image-intake";

const intake = createImageIntake({
  maxUploadBytes: 5 * 1024 * 1024,
  maxDecodedPixels: 20_000_000,
  minSourceEdge: 64,
  acceptedFormats: ["jpeg", "png", "webp"],
  outputEdge: 512,
  outputQualitySteps: [82, 72, 62],
  outputTargetBytes: 120_000,
  outputMaxBytes: 200_000,
});

try {
  const { body, contentType, byteSize } = await intake.process(bytes);
} catch (error) {
  if (error instanceof ImageIntakeError) refuse(error.code);
  throw error;
}
```

## What the order buys you

Each step exists because the one before it is not enough.

1. **Byte length**, before anything is parsed at all.
2. **A header-only metadata read**, so a decompression bomb is refused from the
   dimensions it *claims* rather than by allocating the pixels. A 40 KB file that
   says 30000×30000 never gets decoded.
3. **A format allowlist applied to what the decoder actually recognised** — not to
   the MIME type the client sent, and not to the extension.
4. **Decode → auto-rotate → centre-square → resize → re-encode.** `rotate()` before
   the crop bakes EXIF orientation into the pixels; the re-encode then drops the
   metadata block entirely, so orientation survives while GPS coordinates, camera
   model and the original filename do not.
5. **An output size check** that steps quality down until the payload fits, and
   refuses past a hard ceiling rather than storing an outlier.

`maxDecodedPixels` is enforced twice on purpose — once from metadata, and again as
sharp's own `limitInputPixels` — so a header that lies cannot get past by claiming
small and decoding large.

## Do not add SVG

It is a script-bearing document rather than a raster image, and the renderer
behind sharp will happily rasterise one, with everything that implies for a file a
stranger supplied. Animated formats are refused for a duller reason: they multiply
decode cost for a still result, and a multi-frame file in an accepted container is
rejected too rather than trusted for its extension.

Output format is deliberately not configurable. "Everything is re-encoded to WebP"
is a security property, not a preference — the moment a passthrough exists, the
bytes a stranger supplied are the bytes you serve.

## Rejections

`ImageIntakeError.code` is one of `FILE_TOO_LARGE`, `UNSUPPORTED_IMAGE_TYPE`,
`IMAGE_TOO_LARGE`, `IMAGE_TOO_SMALL`, `IMAGE_UNREADABLE`, `IMAGE_ENCODE_FAILED`.
They are safe to show a user: none of them describes the file beyond why it was
refused.

Residual risk worth naming: a zero-day in the underlying jpeg/png/webp decoders is
not something this removes, and cannot be, if you accept images at all. The byte
and pixel ceilings are what bound its blast radius.
