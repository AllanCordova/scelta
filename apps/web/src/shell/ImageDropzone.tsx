import { useRef, useState, type ChangeEvent, type DragEvent } from "react";

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type ImageDropzoneProps = {
  id: string;
  label?: string;
  value: string | null;
  fileName?: string | null;
  fallbackName?: string;
  maxSizeBytes?: number;
  onChange: (nextUrl: string | null, nextFileName: string | null) => void;
  onError?: (message: string | null) => void;
};

export function ImageDropzone({
  id,
  label = "Foto (opcional)",
  value,
  fileName,
  fallbackName = "SC",
  maxSizeBytes = MAX_IMAGE_BYTES,
  onChange,
  onError,
}: ImageDropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  async function processFile(file: File) {
    onError?.(null);
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      onError?.("Envie uma imagem PNG, JPG, WebP ou GIF.");
      return;
    }
    if (file.size > maxSizeBytes) {
      const maxMb = Math.round(maxSizeBytes / (1024 * 1024));
      onError?.(`A imagem deve ter no máximo ${maxMb} MB.`);
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      onChange(dataUrl, file.name);
    } catch {
      onError?.("Não foi possível ler a imagem selecionada.");
    }
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      void processFile(file);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      void processFile(file);
    }
  }

  function handleClear() {
    onError?.(null);
    onChange(null, null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  return (
    <div className="image-dropzone-field">
      <label htmlFor={id}>{label}</label>
      <div
        className={`upload-zone image-dropzone${dragging ? " dragover" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          onChange={handleFileInputChange}
        />
        <div className="image-dropzone-preview">
          {value ? (
            <img src={value} alt="Pré-visualização da foto" className="member-avatar-img image-dropzone-avatar" />
          ) : (
            <span className="member-avatar-placeholder image-dropzone-avatar" aria-hidden="true">
              {initialsFromName(fallbackName)}
            </span>
          )}
        </div>
        <div className="image-dropzone-copy">
          <p className="image-dropzone-title">
            {value ? fileName || "Imagem selecionada" : "Arraste uma imagem aqui ou selecione do dispositivo"}
          </p>
          <p className="muted image-dropzone-hint">PNG, JPG, WebP ou GIF — até 8 MB</p>
        </div>
        <div className="image-dropzone-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => inputRef.current?.click()}
          >
            {value ? "Trocar imagem" : "Selecionar imagem"}
          </button>
          {value ? (
            <button type="button" className="ghost" onClick={handleClear}>
              Remover foto
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("invalid_result"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

export function initialsFromName(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const first = parts[0];
  if (!first) {
    return "SC";
  }
  if (parts.length === 1) {
    return first.slice(0, 2).toLocaleUpperCase("pt-BR");
  }
  const last = parts[parts.length - 1];
  return `${first[0] ?? ""}${last?.[0] ?? ""}`.toLocaleUpperCase("pt-BR");
}
