export {};

declare global {
  interface Window {
    readerBridge: {
      openPdfDialog(): Promise<{ path: string; name: string; buf: unknown } | null>;
      openMultiPdfDialog(): Promise<{ path: string; name: string; buf: unknown }[]>;
      getWorkerSource(): Promise<string | null>;
      readPdfPath(path: string): Promise<{ path: string; name: string; buf: unknown } | null>;
      readFontFile(file: string): Promise<Uint8Array | null>;
      ocrRecognize(imageBytes: Uint8Array): Promise<{ ok: boolean; text?: string; error?: string }>;
      saveEdits(identity: string, payload: unknown | null): Promise<{ ok: boolean }>;
      loadEdits(identity: string): Promise<unknown | null>;
      writeToPath(path: string, bytes: Uint8Array, saveToken: string): Promise<{ ok: boolean; error?: string }>; // internal chain — must follow savePdfDialog
      savePdfDialog(defaultName: string): Promise<string | null>;
      writePdfFile(path: string, bytes: Uint8Array): Promise<{ ok: boolean; error?: string }>;
      getPlatform(): Promise<string>;
      getPendingPdfPath(): Promise<string | null>;
      confirmExit(): Promise<void>;
      quitApp(): Promise<void>;
      print(): Promise<void>;
      pickWordDoc(): Promise<{ path: string; name: string; buf: unknown } | null>;
      wordToPdf(bytes: Uint8Array): Promise<{ ok: boolean; bytes?: Uint8Array; error?: string; ms?: number }>;
      pickImagesDir(): Promise<string | null>;
      registerImagesDir(dir: string): Promise<{ ok: boolean }>;
      writeImageFile(dir: string, fileName: string, bytes: Uint8Array): Promise<{ ok: boolean; error?: string }>;
      winControls: {
        close(): void;
        minimize(): void;
        toggleMaximize(): void;
        isMaximized(): Promise<boolean>;
      };
      onMenuAction(cb: (a: { action: string; [k: string]: unknown }) => void): () => void;
      onOpenFromOs(cb: (filePath: string) => void): () => void;
    };
  }
}
