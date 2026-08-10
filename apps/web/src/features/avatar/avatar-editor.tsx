"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import {
  AVATAR_FORM_FIELD,
  avatarMessage,
  clampCrop,
  cropRect,
  CROP_MAX_SCALE,
  CROP_MIN_SCALE,
  describeSelection,
  exportEdge,
  initialCropState,
  isCroppableSource,
  type CropState,
} from "./avatar-editor-flow";

/**
 * Avatar editing on the account page (Story 12.6).
 *
 * Privacy boundary, spelled out because it is the whole point of the design:
 * this is a Web/PWA surface, so the only way in is the system file picker the
 * member opens themselves. Nothing here enumerates an album, requests a media
 * permission, or reads anything the member did not pick — `<input type="file">`
 * with `capture` for the camera is the entire surface area, and the picker never
 * opens on its own.
 *
 * The order is choose → crop → confirm → upload. Selecting a photo shows a
 * preview and nothing more; the bytes only leave the device when the member
 * presses save, and what leaves is the cropped square, re-drawn through a canvas
 * (which carries no EXIF) and then stripped again server-side.
 */

export interface AvatarEditorProps {
  nickname: string;
  pulseId: string;
  avatarUrl: string | null;
  avatarVersion: number | null;
  onChange(next: { avatarUrl: string | null; avatarVersion: number | null }): void;
}

const STAGE = 320;

export function AvatarEditor({ nickname, pulseId, avatarUrl, avatarVersion, onChange }: AvatarEditorProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  const [crop, setCrop] = useState<CropState | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const releaseSource = useCallback(() => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    image.current = null;
  }, []);
  useEffect(() => releaseSource, [releaseSource]);

  /** Redraws the stage. Called on every crop change; cheap enough not to throttle. */
  const paint = useCallback((state: CropState) => {
    const context = canvas.current?.getContext("2d");
    const source = image.current;
    if (!context || !source) return;
    context.clearRect(0, 0, STAGE, STAGE);
    const base = (STAGE / Math.min(source.naturalWidth, source.naturalHeight)) * state.scale;
    context.drawImage(source, state.offsetX, state.offsetY, source.naturalWidth * base, source.naturalHeight * base);
    // Circular mask preview, so the member sees the shape the app actually renders.
    context.save();
    context.globalCompositeOperation = "destination-in";
    context.beginPath();
    context.arc(STAGE / 2, STAGE / 2, STAGE / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }, []);

  useEffect(() => { if (crop) paint(crop); }, [crop, paint]);

  async function select(file: File) {
    setError("");
    setNotice("");
    const verdict = describeSelection(file);
    if (!verdict.ok) { setError(avatarMessage(verdict.code)); return; }

    releaseSource();
    const url = URL.createObjectURL(file);
    objectUrl.current = url;
    const element = new Image();
    element.decoding = "async";
    try {
      await new Promise<void>((resolve, reject) => {
        element.onload = () => resolve();
        element.onerror = () => reject(new Error("decode"));
        element.src = url;
      });
    } catch {
      releaseSource();
      setError(avatarMessage("IMAGE_UNREADABLE"));
      return;
    }
    const source = { width: element.naturalWidth, height: element.naturalHeight };
    if (!isCroppableSource(source)) {
      releaseSource();
      setError(avatarMessage("IMAGE_TOO_SMALL"));
      return;
    }
    image.current = element;
    setCrop(initialCropState(source, STAGE));
  }

  function nudge(dx: number, dy: number) {
    const source = image.current;
    if (!source || !crop) return;
    setCrop(clampCrop(
      { ...crop, offsetX: crop.offsetX + dx, offsetY: crop.offsetY + dy },
      { width: source.naturalWidth, height: source.naturalHeight },
      STAGE,
    ));
  }

  function rescale(scale: number) {
    const source = image.current;
    if (!source || !crop) return;
    setCrop(clampCrop({ ...crop, scale }, { width: source.naturalWidth, height: source.naturalHeight }, STAGE));
  }

  function cancel() {
    releaseSource();
    setCrop(null);
    setProgress(0);
    if (fileInput.current) fileInput.current.value = "";
    if (cameraInput.current) cameraInput.current.value = "";
  }

  /** Renders the confirmed square at export resolution and hands back the bytes. */
  async function exportCrop(state: CropState): Promise<Blob> {
    const source = image.current!;
    const rect = cropRect(state, { width: source.naturalWidth, height: source.naturalHeight }, STAGE);
    const edge = exportEdge(rect);
    const out = document.createElement("canvas");
    out.width = edge;
    out.height = edge;
    const context = out.getContext("2d");
    if (!context) throw new Error("CANVAS_UNAVAILABLE");
    context.drawImage(source, rect.sx, rect.sy, rect.size, rect.size, 0, 0, edge, edge);
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/webp", 0.92));
    if (!blob) throw new Error("CANVAS_UNAVAILABLE");
    return blob;
  }

  async function save() {
    if (!crop || !image.current) return;
    setBusy(true);
    setError("");
    setProgress(15);
    try {
      const blob = await exportCrop(crop);
      setProgress(45);
      const body = new FormData();
      body.append(AVATAR_FORM_FIELD, blob, "avatar.webp");
      const response = await fetch("/api/v1/account/avatar", { method: "POST", credentials: "same-origin", body });
      setProgress(85);
      const result = await response.json().catch(() => ({})) as ApiEnvelope<{ avatarUrl: string; avatarVersion: number }> & ApiFailure;
      if (!response.ok) throw new Error(avatarMessage(result.error?.code, result.error?.message || "头像上传失败，请重试。"));
      setProgress(100);
      onChange(result.data);
      setNotice("头像已更新。");
      cancel();
    } catch (reason) {
      // The crop stays on screen on failure — a retry must not cost the member
      // another trip through the picker.
      setError((reason as Error).message || "头像上传失败，请重试。");
      setProgress(0);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("删除后将显示昵称首字母头像，确定删除吗？")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/account/avatar", {
        method: "DELETE", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const result = await response.json().catch(() => ({})) as ApiFailure;
      if (!response.ok) throw new Error(avatarMessage(result.error?.code, result.error?.message || "头像删除失败，请重试。"));
      onChange({ avatarUrl: null, avatarVersion: null });
      setNotice("头像已删除。");
    } catch (reason) {
      setError((reason as Error).message || "头像删除失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="avatar-editor">
        <Avatar src={avatarUrl} version={avatarVersion} nickname={nickname} pulseId={pulseId} size={96} alt={`${nickname} 的当前头像`} />
        <div className="avatar-editor__actions">
          <button type="button" className="avatar-editor__button" disabled={busy} onClick={() => fileInput.current?.click()}>
            {avatarUrl ? "更换头像" : "从相册选择"}
          </button>
          <button type="button" className="avatar-editor__button" disabled={busy} onClick={() => cameraInput.current?.click()}>
            拍照
          </button>
          {avatarUrl && (
            <button type="button" className="avatar-editor__button avatar-editor__button--danger" disabled={busy} onClick={() => void remove()}>
              删除头像
            </button>
          )}
        </div>
      </div>

      {/* The pickers. `accept` narrows what the system dialog offers; the server
          still decodes to decide. Nothing else in the app touches these. */}
      <input
        ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1}
        onChange={(event) => { const file = event.target.files?.[0]; if (file) void select(file); }}
      />
      <input
        ref={cameraInput} type="file" accept="image/*" capture="user" className="sr-only" tabIndex={-1}
        onChange={(event) => { const file = event.target.files?.[0]; if (file) void select(file); }}
      />

      {crop && (
        <div className="avatar-editor__stage">
          <canvas
            ref={canvas} width={STAGE} height={STAGE} className="avatar-editor__canvas"
            aria-label="裁剪预览，可拖动调整位置"
            onPointerDown={(event) => {
              drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const active = drag.current;
              if (!active || active.pointerId !== event.pointerId) return;
              // Pointer travel is in CSS pixels; the stage may be rendered smaller
              // on a 390px viewport, so scale the delta into stage coordinates.
              const ratio = STAGE / event.currentTarget.getBoundingClientRect().width;
              nudge((event.clientX - active.x) * ratio, (event.clientY - active.y) * ratio);
              drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
            }}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
          />
          <label className="mt-3 block text-xs font-bold" htmlFor="avatar-zoom">缩放</label>
          <input
            id="avatar-zoom" type="range" className="avatar-editor__slider"
            min={CROP_MIN_SCALE} max={CROP_MAX_SCALE} step={0.05} value={crop.scale}
            onChange={(event) => rescale(Number(event.target.value))}
          />
          <p className="avatar-editor__note">
            只有你确认后的裁剪结果会上传。上传前会自动去除拍摄位置、设备型号和原始文件名等信息。
          </p>
          {busy && <div className="avatar-editor__progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>}
          <div className="avatar-editor__actions mt-3">
            <button type="button" className="avatar-editor__button avatar-editor__button--primary" disabled={busy} onClick={() => void save()}>
              {busy ? "正在上传…" : "确认并保存"}
            </button>
            <button type="button" className="avatar-editor__button" disabled={busy} onClick={cancel}>取消</button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-xs font-bold text-[var(--coral)]" role="alert">{error}</p>}
      {notice && !error && <p className="mt-3 text-xs font-bold text-[var(--pulse-teal)]" role="status">{notice}</p>}
    </div>
  );
}
