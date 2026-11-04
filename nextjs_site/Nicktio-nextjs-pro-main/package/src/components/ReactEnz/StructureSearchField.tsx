"use client";

import { useEffect, useId, useRef, useState } from "react";

const inputClass = "w-full rounded-xl border border-border bg-hero-bg px-4 py-3 text-sm text-dark outline-none transition focus:border-primary dark:border-dark_border dark:bg-dark_b dark:text-white";
const labelClass = "text-xs font-black uppercase tracking-[0.16em] text-dark/60 dark:text-white/55";
const ghostButtonClass = "rounded-lg border border-border bg-white px-2.5 py-1 text-xs font-black text-midnight_text transition hover:border-primary hover:text-primary dark:border-dark_border dark:bg-darkmode dark:text-white";

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const CHEMDRAW_FILE = /\.(cdx|cdxml|skc)$/i;
const CHEMICAL_FILE = /\.(mol|sdf|sd|rxn|smi|smiles|jme|txt)$/i;

type JsmeEditor = {
  smiles: () => string;
  reset: () => void;
  readGenericMolecularInput: (input: string) => void;
};

declare global {
  interface Window {
    JSApplet?: { JSME: new (id: string, width: string, height: string, options?: { options?: string }) => JsmeEditor };
    jsmeOnLoad?: () => void;
  }
}

let jsmeLoader: Promise<void> | null = null;

function loadJsme(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("JSME is browser-only"));
  if (window.JSApplet?.JSME) return Promise.resolve();
  if (jsmeLoader) return jsmeLoader;
  jsmeLoader = new Promise((resolve, reject) => {
    const ready = () => {
      if (window.JSApplet?.JSME) resolve();
      else reject(new Error("JSME loaded without JSApplet.JSME"));
    };
    const previous = window.jsmeOnLoad;
    window.jsmeOnLoad = () => {
      previous?.();
      ready();
    };
    if (document.querySelector("script[data-jsme='1']")) return;
    const script = document.createElement("script");
    script.src = "/jsme/jsme.nocache.js";
    script.async = true;
    script.dataset.jsme = "1";
    script.onerror = () => reject(new Error("JSME script failed to load"));
    document.head.appendChild(script);
  });
  return jsmeLoader;
}

function looksLikeSingleSmiles(value: string): boolean {
  const token = value.trim();
  if (!token || /[\s\n]/.test(token)) return false;
  return /[=#@\\\/\[\]()0-9]/i.test(token);
}

function structureError(file: File): string | null {
  const name = file.name || "file";
  if (IMAGE_FILE.test(name) || file.type.startsWith("image/")) {
    return "This is a picture, not a chemical file. Draw the structure or export MOL/SDF from ChemDraw. PNG, JPEG, and SVG screenshots are not converted.";
  }
  if (CHEMDRAW_FILE.test(name)) {
    return "ChemDraw binary files are not read here. Save As MDL Molfile (.mol) or SDF, then load that file.";
  }
  if (!CHEMICAL_FILE.test(name) && file.type && !file.type.startsWith("text/") && file.type !== "chemical/x-mdl-molfile") {
    return "Use a MOL, SDF, SMILES, or JME file, or draw the structure.";
  }
  return null;
}

export function StructureSearchField({
  name,
  label,
  defaultValue = "",
  value,
  onChange,
  placeholder,
  replaceOnApply = false,
  maxLength,
  rows = 6,
  compact = false,
}: {
  name?: string;
  label: string;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder: string;
  replaceOnApply?: boolean;
  maxLength?: number;
  rows?: number;
  compact?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [pendingInput, setPendingInput] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const currentText = () => (value ?? textareaRef.current?.value ?? "").trim();

  function writeValue(next: string) {
    if (onChange) onChange(next);
    else if (textareaRef.current) textareaRef.current.value = next;
  }

  return (
    <div className={compact ? "block" : "flex h-full min-h-0 flex-col"}>
      <label htmlFor={inputId} className={`${labelClass} mb-1.5 block whitespace-nowrap`}>{label}</label>
      <span className="mb-2 flex flex-wrap gap-2">
        <button
          className={ghostButtonClass}
          type="button"
          onClick={() => {
            setMessage(null);
            setPendingInput(looksLikeSingleSmiles(currentText()) ? currentText() : "");
            setOpen(true);
          }}
        >
          Draw structure
        </button>
        <button className={ghostButtonClass} type="button" onClick={() => fileRef.current?.click()}>
          Load MOL/SDF
        </button>
      </span>
      <textarea
        id={inputId}
        ref={textareaRef}
        className={`${inputClass} ${compact ? "min-h-28" : "min-h-40 flex-1"} resize-y font-mono`}
        defaultValue={value === undefined ? defaultValue : undefined}
        maxLength={maxLength}
        name={name}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        placeholder={placeholder}
        rows={rows}
        spellCheck={false}
        value={value}
      />
      <input
        ref={fileRef}
        accept=".mol,.sdf,.sd,.rxn,.smi,.smiles,.jme,.txt,chemical/x-mdl-molfile"
        className="hidden"
        type="file"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const rejected = structureError(file);
          if (rejected) {
            setMessage(rejected);
            return;
          }
          const text = (await file.text()).trim();
          if (!text) {
            setMessage("The chemical file was empty.");
            return;
          }
          setMessage(null);
          setPendingInput(text);
          setOpen(true);
        }}
      />
      {message ? <p className="mt-2 text-xs leading-5 text-red-600 dark:text-red-400">{message}</p> : null}
      {open ? (
        <MoleculeSketcher
          initialInput={pendingInput ?? ""}
          title={label}
          onCancel={() => setOpen(false)}
          onApply={(smiles) => {
            const current = currentText();
            writeValue(replaceOnApply || !current || current === smiles ? smiles : `${current}\n${smiles}`);
            setOpen(false);
            setMessage(null);
          }}
        />
      ) : null}
    </div>
  );
}

function MoleculeSketcher({
  initialInput,
  title,
  onApply,
  onCancel,
}: {
  initialInput: string;
  title: string;
  onApply: (smiles: string) => void;
  onCancel: () => void;
}) {
  const hostId = `jsme${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const editorRef = useRef<JsmeEditor | null>(null);
  const [status, setStatus] = useState("Loading the structure editor…");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  useEffect(() => {
    let cancelled = false;
    const host = document.getElementById(hostId);
    if (host) host.replaceChildren();
    loadJsme()
      .then(() => {
        if (cancelled || !window.JSApplet?.JSME) return;
        const editor = new window.JSApplet.JSME(hostId, "100%", "380px", {
          options: "newlook,useopenchemlib,paste,star",
        });
        editorRef.current = editor;
        if (initialInput) {
          try {
            editor.readGenericMolecularInput(initialInput);
          } catch {
            setStatus("The file opened, but JSME could not parse it. Draw the structure instead.");
            return;
          }
        }
        setStatus("");
      })
      .catch(() => {
        if (!cancelled) setStatus("The structure editor failed to load. Paste SMILES or try again.");
      });
    return () => {
      cancelled = true;
      editorRef.current = null;
    };
  }, [hostId, initialInput]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel} role="presentation">
      <div
        className="w-full max-w-3xl rounded-[24px] border border-border bg-white p-5 shadow-xl dark:border-dark_border dark:bg-darkmode"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Draw ${title}`}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-dark/60 dark:text-white/55">Draw or load a structure</p>
            <h3 className="mt-1 text-lg font-black text-midnight_text dark:text-white">{title}</h3>
          </div>
          <button className={ghostButtonClass} type="button" onClick={onCancel}>Close</button>
        </div>
        <p className="mb-3 text-xs leading-5 text-muted">
          Draw the molecule, or load a MOL/SDF file. Use this structure writes SMILES into the input. Pictures of molecules are not converted.
        </p>
        <div id={hostId} className="h-[380px] overflow-hidden rounded-xl bg-white" />
        {status ? <p className="mt-3 text-xs leading-5 text-muted">{status}</p> : null}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] leading-5 text-muted">
            Editor: JSME (BSD). Bienfait and Ertl, J. Cheminformatics 2013.
          </p>
          <div className="flex gap-2">
            <button className={ghostButtonClass} type="button" onClick={onCancel}>Cancel</button>
            <button
              className="rounded-lg bg-primary px-4 py-1.5 text-xs font-black text-white transition hover:bg-primary/90"
              type="button"
              onClick={() => {
                const smiles = editorRef.current?.smiles()?.trim() ?? "";
                if (!smiles) {
                  setStatus("Draw a structure first.");
                  return;
                }
                onApply(smiles);
              }}
            >
              Use this structure
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
