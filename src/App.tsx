import { Component, lazy, Suspense, type ReactNode } from "react"
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { api, ApiError } from "@/lib/api"
import { queryClient, useBootstrap, useConfig, useMe } from "@/lib/data"
import { AuthScreen } from "@/app/auth-screen"
import { Workspace } from "@/app/workspace"
import { Logo } from "@/app/bits"
const PublicView = lazy(() => import("@/app/public-view").then((m) => ({ default: m.PublicView })))
const PrivacyPage = lazy(() => import("@/app/legal").then((m) => ({ default: m.PrivacyPage })))
const TermsPage = lazy(() => import("@/app/legal").then((m) => ({ default: m.TermsPage })))

export default function App() {
  const path = window.location.pathname.replace(/\/$/, "")
  const share = path.match(/^\/s\/([A-Za-z0-9_-]{8,64})$/)
  if (path === "/privacy" || path === "/terms")
    return <Suspense fallback={<Splash />}>{path === "/privacy" ? <PrivacyPage /> : <TermsPage />}</Suspense>
  return (
    <CrashGuard>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delay={400}>
          {share ? (
            <Suspense fallback={<Splash />}>
              <PublicView token={share[1]!} />
            </Suspense>
          ) : (
            <Gate />
          )}
          <Toaster position="top-center" richColors={false} closeButton={false} />
        </TooltipProvider>
      </QueryClientProvider>
    </CrashGuard>
  )
}

/** A bug in one screen should never leave people staring at a blank page. */
class CrashGuard extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error(error)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas px-6 text-center">
        <div className="grid max-w-sm justify-items-center gap-3">
          <Logo className="size-11 rounded-xl" />
          <h1 className="text-lg font-semibold">Something went wrong on this screen</h1>
          <p className="text-[14px] text-muted-foreground">Your data is safe. Reload to continue.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="h-11 rounded-xl bg-primary px-5 text-[15px] font-medium text-primary-foreground"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}

function Gate() {
  const qc = useQueryClient()
  const config = useConfig()
  const me = useMe()
  const signedIn = Boolean(me.data?.user)
  const boot = useBootstrap(signedIn)

  if (config.isLoading || me.isLoading || (signedIn && boot.isLoading)) return <Splash />
  if (config.isError) return <Splash message="Cannot reach the server. Check your connection and refresh." />
  if (!signedIn) return <AuthScreen config={config.data!} />
  if (boot.isError) {
    if ((boot.error as ApiError).status === 401) return <AuthScreen config={config.data!} />
    return <Splash message={(boot.error as Error).message} />
  }

  return (
    <Workspace
      boot={boot.data!}
      onSignOut={async () => {
        await api("/api/auth/logout", { body: {} }).catch(() => {})
        qc.clear()
        window.location.replace("/")
      }}
    />
  )
}

function Splash({ message }: { message?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas">
      <div className="grid justify-items-center gap-4">
        <Logo className="size-11 animate-pulse rounded-xl" />
        {message && <p className="max-w-xs text-center text-[14px] text-muted-foreground">{message}</p>}
      </div>
    </div>
  )
}
