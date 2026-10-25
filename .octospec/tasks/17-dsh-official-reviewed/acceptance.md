---
type: Acceptance
title: Official DSH Client review and live qualification
timestamp: 2026-10-25T02:15:00Z
---

# Scope and Review

Replacement PR #176 follows withdrawal #175 and supersedes closed #174. The updated withdrawal baseline is `703b69ead2ee0f49a6aa54c9751d4013126ab797`; it removes DSH while preserving generic diagnostics requested by review. Main must receive that withdrawal before the replacement is merged. A merged #173 cannot be withdrawn by editing its GitHub metadata.

The runtime implementation reviewed and exercised below is `f7a69a800b3a94cbf100f12ddd5ad9ef5c9873cc`. Rebase onto the updated withdrawal produced identical production sources: the only subsequent code differences are two non-DSH logging regressions and stronger offline-release verification. The SDK remains the actual official `HarnessClient@0.2.1-rc.3` with two disclosed downstream safety patches; no custom Client or sink is substituted.

Verified-review plus independent Standards and Spec reviews reproduced and repaired these findings:

- Raw oversized initialize responses previously succeeded; the patched official reader rejects them before decoding/parsing with `PROVIDER_MESSAGE_TOO_LARGE`.
- A tool ignoring SIGTERM survived after its parent exited and the old adapter reported a terminal. The existing Adapter SDK process-group cleanup now confirms its death before the terminal.
- Official Client stderr and pre-filter lineage were unbounded. Diagnostic suffix/aggregate limits and a 128-relationship limit now bound those paths and fail closed.
- Version-probe IO and nonzero-exit diagnostics lost their original evidence. Native errno/exit/signal and primary-plus-cleanup errors are now preserved safely.
- Packaging no longer assumes a fixed upstream entry filename. Distributed patches and full upstream MIT licenses are checked, and the installed adapter is tested against the raw-response and orphan regressions.

Final source re-reviews found no remaining actionable findings. This is local review evidence, separate from GitHub approvals and protected-branch checks.

# Automated Checks

On `f7a69a8`, `pnpm build`, `pnpm lint`, `pnpm lint:names`, `pnpm format:check`, `pnpm docs:check`, TypeScript no-emit and `git diff --check` passed. `pnpm test:suites` passed 1,746 Node tests, skipped 40, failed zero; 35 UI tests passed. The targeted DSH and official Protocol/Client boundary suite passed 39 tests with zero skips.

The updated withdrawal independently passed build and the same static checks, 65 targeted tests and its complete suites: 1,709 Node passes, 40 skips, zero failures; 35 UI passes. Its new tests cover persisted safe process facts, rejection of bodies/invalid numbers and the actual Core-to-Adapter log chain.

The raw-response/orphan before-and-after probe ran against the preserved old official-client branch and the corrected branch. It cleaned its own subprocesses in all outcomes. Native Windows process-tree tests are not inferred from POSIX results.

# Real Desktop and IM

`node scripts/verify-dsh-live.mjs` passed against the installed macOS DeepSeek Harness Desktop CLI `0.2.1-rc.3`: new session, explicit resume with a remembered marker, actual file write/read, missing-session rejection, provider failure, cancellation with an independent successful sibling and recovery. Shutdown reported complete with no errors or pending resources. This run used the pre-retention-fix implementation; the final browser run below exercised `f7a69a8`.

SDK-hosted and CLI-hosted group runs used the real im-test service and existing QA accounts:

```sh
OCTO_CHANNEL_QA_ACCOUNTS=<local-account-file> node scripts/verify-gateway-drain-live.mjs --dsh --cards --skip-dm
OCTO_CHANNEL_QA_ACCOUNTS=<local-account-file> node scripts/verify-gateway-drain-live.mjs --dsh --cards --skip-dm --cli
```

Both passed group mention admission, denial without mention, same-session continuation, actual tool events, terminal/same-message card acknowledgement, failure card, drain, restart and sibling/kernel preservation. Drain took 244 ms and 166 ms respectively. These were backend acknowledgement/readback checks, rather than visual browser claims. The Bot-to-Bot DM case was explicitly skipped because those peers are not friends; no friendship was created.

On `f7a69a8`, a separate actual Chrome DOM run used the already logged-in human account and existing `orbtex-codex` friendship. Messages were entered in the real conversation composer, not injected through the messaging API:

1. First reply was exactly `DSH_OFFICIAL_V2_f7a69a8`.
2. A subsequent prompt omitted that marker and still returned it exactly, proving continuation.
3. Real `write` and `read` tools created and read the private working-directory file. The expanded card showed both completed; an independent filesystem read confirmed its exact content. Final answer: `DSH_BROWSER_TOOL_OK`.
4. A missing-executable fault displayed a failed card and reply with `OH-ADP-3002`, stable reason `DSH_EXECUTABLE_NOT_FOUND` and a diagnostic ID.
5. Restoring the real configuration returned exactly `DSH_BROWSER_RECOVERY_f7a69a8`.

After all five messages the Gateway had zero working/queued tasks. Gateway and Kernel shutdown both reported `complete: true`, empty errors and empty pending resources. Their private temporary working directory was removed. Browser login was preserved. DOM evidence was observed; attempted OS screenshots exposed only wallpaper, so no screenshot is counted as visual proof. Browser cancellation was not exercised in this final run; cancellation evidence comes from the live Kernel and automated tests.

# Offline Release and Remaining Conditions

An empty-cache offline npm installation of the clean `f7a69a8` archive passed public SDK/type/component examples, CLI, native Kernel, independent Extra, status, uninstall-preserved-home and the strengthened installed-DSH checks. The verifier checked the archive's full expected commit and `dirty: false`; both patches matched the tracked source, three oversized raw-input variants failed with the expected reason and the POSIX orphan was gone before its terminal. Final delivery archive identity and hosted CI are recorded in the PR rather than inferred from this earlier archive.

Native Windows DSH and cleanup after its leader exits remain unqualified under #14. Interactive approval, unsupported actmodes and live per-token notifications remain outside the upstream capability contract. #175 and #176 still require their normal GitHub approvals/checks; local success does not override a changes-requested review or imply either PR has merged.
