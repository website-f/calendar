import { Logo } from "./bits"

const CONTACT = "gitdev1234@gmail.com"
const UPDATED = "14 November 2026"

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas px-5 pt-safe pb-16">
      <div className="mx-auto max-w-2xl">
        <a href="/" className="flex h-16 items-center gap-2.5">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">Orion Calendar</span>
        </a>
        <article className="rounded-2xl border bg-background p-6 shadow-soft md:p-10">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Last updated {UPDATED}</p>
          <div className="mt-6 grid gap-5 text-[15px] leading-relaxed [&_h2]:mt-2 [&_h2]:text-[16px] [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:grid [&_ul]:gap-1.5">
            {children}
          </div>
        </article>
        <p className="mt-6 flex gap-4 text-[13px] text-muted-foreground">
          <a href="/privacy" className="hover:text-foreground">Privacy</a>
          <a href="/terms" className="hover:text-foreground">Terms</a>
          <a href="/" className="hover:text-foreground">Open the calendar</a>
        </p>
      </div>
    </div>
  )
}

export function PrivacyPage() {
  return (
    <Shell title="Privacy policy">
      <p>
        Orion Calendar (calendar.oriondesk.space) is an office schedule used by invited team members. This page explains what it stores and how it uses
        Google data.
      </p>
      <h2>What we store</h2>
      <ul>
        <li>Your account: name, work email, a colour, your role, and a scrambled (hashed) password.</li>
        <li>What your team enters: events, projects, notes, daily data, links and the activity history of each event.</li>
        <li>A sign-in cookie that keeps you logged in for up to 30 days.</li>
      </ul>
      <p>Everything is stored on our own server. We do not sell data, show ads, or share data with anyone outside your team, except through view-only links your team creates on purpose.</p>
      <h2>Google data</h2>
      <p>Connecting Google is optional. When you connect, the app asks Google for:</p>
      <ul>
        <li>
          <strong>Your name and email</strong>, to show which Google account is connected.
        </li>
        <li>
          <strong>Access to files you use with this app</strong> (Google Drive "drive.file"), so it can create a spreadsheet when you export, and open a
          file you choose in the Drive picker. It cannot see any other file in your Drive.
        </li>
      </ul>
      <p>
        The Google access token stays in your browser for the session and is never sent to or stored on our server. When you attach a Drive file, we store
        only its name and link. You can disconnect at any time in the app, or remove access at myaccount.google.com/permissions.
      </p>
      <p>
        Orion Calendar's use and transfer of information received from Google APIs adheres to the{" "}
        <a className="text-primary underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>
      <h2>Deleting data</h2>
      <p>An admin can remove any account, event or link at any time. To ask for your data to be deleted, contact us below.</p>
      <h2>Contact</h2>
      <p>
        <a className="text-primary underline" href={`mailto:${CONTACT}`}>
          {CONTACT}
        </a>
      </p>
    </Shell>
  )
}

export function TermsPage() {
  return (
    <Shell title="Terms of use">
      <p>Orion Calendar is provided to invited team members to plan and track work. By using it you agree to these terms.</p>
      <ul>
        <li>Use it for your team's work and keep your password to yourself.</li>
        <li>You are responsible for what you enter and for the view-only links you share.</li>
        <li>Don't upload anything unlawful or anything you don't have the right to share.</li>
        <li>We may change or pause the service, and admins may remove accounts or content.</li>
        <li>The service is provided as is, without warranties, to the extent the law allows.</li>
      </ul>
      <p>
        Questions:{" "}
        <a className="text-primary underline" href={`mailto:${CONTACT}`}>
          {CONTACT}
        </a>
      </p>
    </Shell>
  )
}
