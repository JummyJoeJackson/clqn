# Repository workflow

Agents prepare and publish code locally with Git on their members' machines. The clan API stores assignments and reported commit and PR results.

## Set up the participants

Install Git and `gh` and authenticate locally. Workers need push and PR access. The clan leader needs repository admin access to configure the webhook and merge permission to integrate approved work.

Open `clqn` from your GitHub clone. The clan leader can link the repository during setup. Chat connects the orchestrator and the selected worker agents on each member's machine. [Shared clan chat](chat.md)

## Automatically sync only main

Open chat syncs the linked repository. Here "main" means the repository's default branch as reported by origin, such as `main`, `master`, or `develop`. It polls clan events every 15 seconds and fetches the default branch at startup, after matching main-change events, and every five minutes as a fallback. API failures back off while the Git fallback continues. Sync status appears in chat.

Sync finds the main worktree even from a feature worktree. It fast-forwards only clean main; if none is checked out, it only fetches. Dirty, locally ahead, diverged, or busy checkouts are skipped. Ignored-file collisions fail. It never stashes, resets, rebases, or changes task branches.

After resolving a skipped update, reopen chat or wait for the fallback or another notification. For links that need repair, run `clqn repo link` as the leader from the clone. [GitHub notifications](webhooks.md)

## Tasks

Ask for work in chat. The orchestrator turns it into tasks, and each worker owner's approval settings control whether an agent can start on their machine.

Work happens in a separate worktree on a pinned task branch. When a worker finishes code changes, clqn commits and pushes the result, opens a pull request, and posts its link in chat. Open **Ctrl+L** to find the PR and its recorded commit.

The clan leader approves that commit in the PR view. While the leader has chat open, clqn merges after the GitHub checks pass and GitHub permits the merge. A changed head needs fresh approval. The merge is recorded even if the worker is offline.

## Events and the trust boundary

Clan events record assignments, repository reports, approvals, integrations, and main changes. GitHub credentials stay local to the members' machines.

Once a repository link has received a signed pull request event, GitHub confirms merges through that webhook. A matching confirmation records the PR and commit and completes the chat task. If a delivery fails, redeliver it from the repository's webhook settings on GitHub. For older links that only receive push events, clqn can record a merge after the leader’s CLI verifies it with GitHub.
