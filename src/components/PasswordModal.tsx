import { useState } from "react";
import { Lock } from "lucide-react";

export default function PasswordModal({
  name,
  wrong,
  onSubmit,
  onCancel,
  mode = "unlock"
}: {
  name: string;
  wrong: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
  /** "unlock" = open a protected doc; "protect" = set the save password (empty = remove) */
  mode?: "unlock" | "protect";
}) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const protect = mode === "protect";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (protect && pw !== confirm) return; // mismatch hint is shown above
          onSubmit(pw);
        }}
        className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 w-[340px] shadow-2xl"
      >
        <div className="flex items-center gap-2 mb-2 text-white">
          <Lock size={16} className={protect ? "text-blue-400" : "text-amber-400"} />
          <h2 className="font-semibold">{protect ? "Protect this PDF" : "Password required"}</h2>
        </div>
        {protect ? (
          <p className="text-[13px] text-zinc-400 mb-4 break-all">
            Set an open password for “{name}”{wrong ? " — the two entries didn't match" : ""}. It is applied when you
            save. Leave both empty to remove protection.
          </p>
        ) : (
          <p className="text-[13px] text-zinc-400 mb-4 break-all">
            “{name}” is protected{wrong ? " — that password was rejected" : ""}. Enter the password to open it.
          </p>
        )}
        <input
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-zinc-100 outline-none focus:border-zinc-500 mb-3"
          placeholder={protect ? "New password (empty = remove)" : "Password"}
          aria-label={protect ? "New password" : "Password"}
        />
        {protect && (
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-zinc-100 outline-none focus:border-zinc-500 mb-4"
            placeholder="Repeat password"
            aria-label="Repeat password"
          />
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-md text-zinc-300 hover:bg-zinc-800">
            Cancel
          </button>
          <button type="submit" className="px-3 py-1.5 rounded-md text-white font-medium hover:opacity-90 transition-opacity"
          style={{ background: "linear-gradient(135deg, #FF6B6B 0%, #FF8E53 100%)" }}>
            {protect ? "Set password" : "Unlock"}
          </button>
        </div>
      </form>
    </div>
  );
}
