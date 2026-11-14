import { QueryClientProvider, useQueryClient } from "@tanstack/react-query"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { api, ApiError } from "@/lib/api"
import { queryClient, useBootstrap, useConfig, useMe } from "@/lib/data"
import { AuthScreen } from "@/app/auth-screen"
import { PublicView } from "@/app/public-view"
import { Workspace } from "@/app/workspace"
import { Logo } from "@/app/bits"
import { PrivacyPage, TermsPage } from "@/app/legal"

export default function App() {
  const path = window.location.pathname.replace(/\/$/, "")
  const share = path.match(/^\/s\/([A-Za-z0-9_-]{8,64})$/)
  if (path === "/privacy") return <PrivacyPage />
  if (path === "/terms") return <TermsPage />
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delay={400}>
        {share ? <PublicView token={share[1]!} /> : <Gate />}
        <Toaster position="top-center" richColors={false} closeButton={false} />
      </TooltipProvider>
    </QueryClientProvider>
  )
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
