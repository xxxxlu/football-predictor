"use client";

import { useRef, useState } from "react";
import Image from "next/image";

export function PrivacyPhotoUpload({ onCollect, collected }: { onCollect: (photo: object) => Promise<boolean>; collected: boolean }) {
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploadError("");
    setUploaded(false);
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      setUploadError("仅支持 JPG、PNG、WebP 或 GIF 图片");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setUploadError("图片大小不能超过 2MB，请先压缩后重试");
      return;
    }

    setUploading(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      setPreview(dataUrl);
      const succeeded = await onCollect({
        dataUrl,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
      });
      setUploaded(succeeded);
      if (!succeeded) setUploadError("照片提交失败，请检查网络后重试");
      setUploading(false);
    };
    reader.onerror = () => {
      setUploadError("无法读取这张图片，请重新选择");
      setUploading(false);
    };
    reader.readAsDataURL(file);
  };

  if (!collected) {
    return (
      <p className="text-xs text-[var(--muted)]">
        开启授权后，可以选择照片上传作为头像。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-bold text-[var(--field)]">✓ 应用内照片授权已开启</p>
      <p className="text-xs leading-5 text-[var(--muted)]">
        应用内授权已开启；选择照片或拍照时，手机系统仍会单独确认访问权限。
      </p>

      {preview && (
        <div className="flex items-center gap-3">
          <div className="size-14 overflow-hidden rounded-full border-2 border-[var(--line)]">
            <Image src={preview} alt="预览" width={56} height={56} unoptimized className="size-full object-cover" />
          </div>
          {uploaded && <span className="text-xs text-[var(--field)]">✓ 已上传</span>}
        </div>
      )}

      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelect}
        className="hidden"
      />

      {uploadError && <p role="alert" className="text-xs font-bold text-[var(--coral)]">{uploadError}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={uploading}
          onClick={() => galleryInputRef.current?.click()}
          className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 text-xs font-bold transition hover:bg-[var(--ink)] hover:text-white disabled:opacity-45"
        >
          {uploading ? "上传中…" : preview ? "重新选择照片" : "从相册选择"}
        </button>
        <button
          type="button"
          disabled={uploading}
          onClick={() => cameraInputRef.current?.click()}
          className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 text-xs font-bold transition hover:bg-[var(--ink)] hover:text-white disabled:opacity-45"
        >
          拍照上传
        </button>
      </div>
    </div>
  );
}
