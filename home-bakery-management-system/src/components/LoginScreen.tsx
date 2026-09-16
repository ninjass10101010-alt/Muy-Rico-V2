import { useAuth } from "../context/AuthContext";

export default function LoginScreen() {
  const { signIn, minting, error } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-sand-50 px-6">
      <div className="w-full max-w-sm text-center">
        <img
          src="/muy_rico_logo_transparent.webp"
          alt="Muy Rico"
          className="mx-auto h-24 w-auto"
        />
        <h1 className="mt-6 text-2xl font-semibold text-cocoa">Muy Rico Dashboard</h1>
        <p className="mt-2 text-sm text-cocoa/70">
          Sign in to manage orders, products, and inventory.
        </p>
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        <button
          onClick={signIn}
          disabled={minting}
          className="mt-6 w-full rounded-lg px-4 py-3 font-medium text-white disabled:opacity-60"
          style={{ backgroundColor: "#1E4636" }}
        >
          {minting ? "Signing in…" : "Sign in with email PIN"}
        </button>
        <p className="mt-4 text-xs text-cocoa/50">
          You'll receive a one-time PIN by email, then stay signed in on this device.
        </p>
      </div>
    </div>
  );
}
