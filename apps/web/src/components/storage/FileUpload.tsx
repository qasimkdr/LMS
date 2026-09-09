import {
  AttachFileRounded,
  CloudUploadRounded,
  ErrorOutlineRounded,
  OpenInNewRounded,
} from "@mui/icons-material";
import { Alert, Button, CircularProgress, LinearProgress } from "@mui/material";
import axios from "axios";
import { useState } from "react";
import { api } from "../../lib/api";

type Props = {
  value?: string;
  onChange: (reference: string) => void;
  category:
    | "school-logo"
    | "profile-image"
    | "assignment"
    | "material"
    | "submission"
    | "exam"
    | "report"
    | "general";
  label?: string;
  disabled?: boolean;
  accept?: string;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  csv: "text/csv",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  zip: "application/zip",
};

const inferMimeType = (file: File) => {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
};

const friendlyError = (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;
    if (typeof message === "string" && message.trim()) return message;
    if (error.response?.status === 413)
      return "This file is too large or the school storage quota is full.";
    if (error.response?.status === 415) return "This file type is not allowed.";
  }
  return error instanceof Error && error.message ? error.message : fallback;
};

export async function openStorageReference(reference: string) {
  if (!reference) return;
  if (reference.startsWith("storage://")) {
    const { data } = await api.post("/storage/sign", { reference });
    window.open(data.url, "_blank", "noopener,noreferrer");
    return;
  }
  window.open(reference, "_blank", "noopener,noreferrer");
}

export default function FileUpload({
  value,
  onChange,
  category,
  label = "Upload file",
  disabled,
  accept = ".pdf,.docx,.txt,.csv,.jpg,.jpeg,.png,.webp,.gif,.mp4,.webm,.zip",
}: Props) {
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [progress, setProgress] = useState(0);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const upload = async (file: File) => {
    setBusy(true);
    setName(file.name);
    setProgress(0);
    setError("");

    if (file.size <= 0) {
      setBusy(false);
      setError("The selected file is empty.");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setBusy(false);
      setError("The maximum upload size is 50 MB.");
      return;
    }

    try {
      const mimeType = inferMimeType(file);
      const { data } = await api.post("/storage/upload", file, {
        params: { fileName: file.name, mimeType, category },
        headers: { "Content-Type": "application/octet-stream" },
        onUploadProgress: (event) =>
          setProgress(
            event.total ? Math.round((event.loaded / event.total) * 100) : 0,
          ),
      });
      onChange(data.reference);
      setProgress(100);
    } catch (uploadError) {
      setProgress(0);
      setError(friendlyError(uploadError, "The file could not be uploaded."));
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    if (!value || opening) return;
    setOpening(true);
    setError("");
    try {
      await openStorageReference(value);
    } catch (openError) {
      setError(friendlyError(openError, "The file could not be opened."));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <Button
        component="label"
        variant="outlined"
        disabled={disabled || busy}
        startIcon={
          busy ? <CircularProgress size={17} /> : <CloudUploadRounded />
        }
        sx={{ borderRadius: 3, fontWeight: 800 }}
      >
        {busy ? `Uploading ${progress}%` : label}
        <input
          hidden
          type="file"
          accept={accept}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.currentTarget.value = "";
          }}
        />
      </Button>

      {value && (
        <Button
          size="small"
          startIcon={
            opening ? <CircularProgress size={14} /> : <OpenInNewRounded />
          }
          disabled={opening}
          onClick={() => void open()}
        >
          {opening ? "Opening..." : "Open"}
        </Button>
      )}
      {value && (
        <Button
          size="small"
          color="error"
          onClick={() => {
            setError("");
            onChange("");
          }}
        >
          Remove
        </Button>
      )}
      {name && (
        <span className="max-w-56 truncate text-xs font-bold text-slate-400">
          <AttachFileRounded sx={{ fontSize: 14 }} /> {name}
        </span>
      )}
      {busy && (
        <div className="w-full">
          <LinearProgress variant="determinate" value={progress} />
        </div>
      )}
      {error && (
        <Alert
          severity="error"
          icon={<ErrorOutlineRounded fontSize="inherit" />}
          onClose={() => setError("")}
          sx={{ width: "100%", borderRadius: 3 }}
        >
          {error}
        </Alert>
      )}
    </div>
  );
}
