# clqn — Roadmap

Type `clqn`, and a chat opens in your terminal. You talk to one orchestrator agent, and it gets the work done using your team's agents. Tasks, branches, and agents all happen behind the scenes.

## How it works

1. **Type `clqn`.** That's the only command. The first time, it signs you in with GitHub.
2. **Make or join a clan.** Pick "Create a clan" or "Join a clan" (your invites are listed). Then the full-screen chat opens, and everything happens there.
3. **Message the orchestrator.** Everyone in the clan talks to the same orchestrator, which runs on the leader's machine. Messages wait in a queue and get handled in order.
4. **The orchestrator splits up the work.** It turns requests into tasks and picks who should do each one. You never manage tasks yourself.
5. **You say yes or no.** When the orchestrator wants to start an agent on your machine, you get asked. Type `y` or `n`. It never goes over your limits.
6. **Watch it happen.** A sidebar shows who's working, task progress, and tokens used over time.
7. **Your `main` stays current.** When `main` changes on GitHub, your local copy updates by itself, but only if you have no uncommitted changes.

## Member limits

Each member sets their own:

- **Token limit:** total tokens their agents can use
- **Agent count:** how many agents can run on their machine at once
- **Models:** which models their agents are allowed to use

## What's done

- Sign in with GitHub, create a clan, and invite teammates by email
- Connect Claude Code or Codex to a clan
- Tasks with clear ownership: assign, claim, open a pull request, merge
- A shared clan chat that's saved on the server
- An orchestrator role (one per clan, belongs to the leader)
- Model limits are saved (but not enforced yet)
- The chat screen: `clqn` opens a full-screen chat with an agents sidebar and settings (F2)
- Message queue in PostgreSQL: messages stay queued until the orchestrator handles them
- The orchestrator handles the queue through MCP tools (inbox, decide, report) when the leader runs it with `clqn agent run`
- Yes/no approvals in the chat (F3, then `y`/`n`), or automatic approval
- Token and agent-count limits enforced before each delegation
- Live sidebar: each delegation's task, worker, status, tokens, and a 24h clan token graph
- GitHub webhooks tell connected agents when `main` changes, and clean checkouts sync
- The API runs on Google Cloud (Cloud Run + PostgreSQL)

## What's next

1. **One command.** `clqn` signs you in with GitHub if needed, then offers "Create a clan" or "Join a clan" (with your pending invites), then opens the chat. Remove `clqn init` and `clqn join`. Remove `clqn login` and `clqn logout`, and add "Sign out" to settings (F2).
2. **Orchestrator loop.** When the leader opens `clqn`, the orchestrator starts in the background and works the queue. No `clqn agent run`.
3. **Run approved agents.** After a `y`, the member's machine starts the agent in the background. `clqn agent run` becomes a debugging fallback.
4. **Model limits.** Enforce each member's allowed models.
5. **`main` sync in the chat screen.** Link the repo during setup, and keep `main` synced while `clqn` is open.
6. **Update documentation (README - concise, user focused), website**

## Later

- **Turn `main` protection back on.** It's off for now so we can push and force-push straight to `main` while building the basics. Turn the branch protection rules back on before the first real release.
- **Terminal too small.** If the window can't fit the chat screen, show "Please make your terminal bigger" until it fits.
- **Orchestrator handoffs** between users if host leaves. 

## Ground rules

- **Your machine, your call.** Nothing runs on your computer without your "yes".
- **Hide the plumbing.** People chat and approve. Tasks, branches, and agents are the orchestrator's job.
- **Keep it simple.** Small working steps, few dependencies, minimal cloud setup.
- **Chat isn't a command.** Treat messages as untrusted. Only approved tasks lead to real work.
- **Never touch your work.** Only sync a clean `main`. Never rebase, reset, or stash your changes.
- **Secrets stay on the server**, and everything is scoped to its clan.
