/**
 * Gauntlet CLI commands.
 *
 * Registers `boop gauntlet run|list|report|diff` subcommands.
 */
import path from "node:path";
import { Command } from "commander";
import { resolveGauntletDir, listAvailableGauntlets, loadGauntletByName } from "./tier-loader.js";
import { loadGauntletIndex, loadGauntletResult } from "./history.js";
import { generateGauntletReport } from "./report.js";
import { getDiffStats, isCleanWorkingTree, tagExists } from "./git-tagger.js";
import type { ApprovalAction, ApprovalCallback, GauntletTierResult } from "./types.js";

/**
 * Register gauntlet subcommands on the program.
 *
 * @param program - The root Commander program.
 * @param projectRoot - Project root directory.
 */
export function registerGauntletCommands(program: Command, projectRoot?: string): void {
  const root = projectRoot ?? process.cwd();

  const gauntlet = program
    .command("gauntlet")
    .description("Run graduated complexity gauntlets against the pipeline");

  // --- gauntlet run ---
  gauntlet
    .command("run")
    .description("Run a gauntlet")
    .argument("[definition]", "gauntlet name (default: gauntlet-v1)", "gauntlet-v1")
    .option("--tier <N>", "only run up to tier N", Number.parseInt)
    .option("--start <N>", "resume from tier N", Number.parseInt)
    .option("--workspace <dir>", "override workspace directory")
    .option("--no-approve", "auto-approve evolution (DANGEROUS, for CI)")
    .action(
      async (
        defName: string,
        opts: { tier?: number; start?: number; workspace?: string; approve?: boolean },
      ) => {
        const gauntletDir = resolveGauntletDir(root);

        let definition;
        try {
          definition = loadGauntletByName(defName, gauntletDir);
        } catch {
          console.error(`[boop] Gauntlet "${defName}" not found.`);
          const available = listAvailableGauntlets(gauntletDir);
          console.error(
            `[boop] Available: ${available.map((g) => g.name).join(", ") || "(none)"}`,
          );
          process.exitCode = 1;
          return;
        }

        // Check clean working tree
        if (!isCleanWorkingTree(root)) {
          console.error("[boop] Working tree is dirty. Please commit or stash changes before running the gauntlet.");
          process.exitCode = 1;
          return;
        }

        const workspaceDir =
          opts.workspace ?? path.join(root, ".gauntlet-workspace");

        console.log(`[boop] Running gauntlet "${definition.name}"`);
        if (opts.tier) console.log(`[boop] Max tier: ${opts.tier}`);
        if (opts.start) console.log(`[boop] Starting from tier: ${opts.start}`);
        if (opts.approve === false) console.log("[boop] WARNING: Auto-approving all evolution steps.");
        console.log("");

        // Lazily import to avoid loading pipeline code at CLI parse time
        const { runGauntlet } = await import("./runner.js");
        const { saveGauntletResult } = await import("./history.js");
        const { loadProfileFromDisk } = await import("../config/index.js");

        const profile = loadProfileFromDisk();
        if (!profile) {
          console.error("[boop] No developer profile found. Please run onboarding first.");
          process.exitCode = 1;
          return;
        }

        // Build approval callback
        let approvalCallback: ApprovalCallback | undefined;
        if (opts.approve !== false) {
          approvalCallback = async (
            _tierResult: GauntletTierResult,
            report: string,
            driftStats: { filesChanged: number; insertions: number; deletions: number },
          ): Promise<ApprovalAction> => {
            console.log("");
            console.log("═".repeat(60));
            console.log("APPROVAL GATE");
            console.log("═".repeat(60));
            console.log("");
            console.log(report);
            console.log("");
            console.log("Cumulative drift from baseline:");
            console.log(`  Files changed: ${driftStats.filesChanged}`);
            console.log(`  Insertions: ${driftStats.insertions}`);
            console.log(`  Deletions: ${driftStats.deletions}`);
            console.log("");

            const { select, isCancel } = await import("@clack/prompts");
            const action = await select({
              message: "How would you like to proceed?",
              options: [
                { value: "approve", label: "Approve evolution and continue" },
                { value: "skip", label: "Skip evolution, continue to next tier" },
                { value: "stop", label: "Stop gauntlet here" },
              ],
            });

            if (isCancel(action)) return "stop";
            return action as ApprovalAction;
          };
        }

        const result = await runGauntlet({
          definitionPath: path.join(gauntletDir, `${defName}.yaml`),
          workspaceDir,
          baseProfile: profile,
          projectRoot: root,
          maxTier: opts.tier,
          startTier: opts.start,
          approvalCallback,
          onProgress: (tierId, msg) => {
            console.log(`[boop] [${tierId}] ${msg}`);
          },
        });

        // Save result
        const runId = saveGauntletResult(result);
        console.log("");
        console.log(`[boop] Gauntlet complete. Run saved as: ${runId}`);
        console.log(
          `[boop] Passed: ${result.summary.passed}/${result.summary.totalTiers} tiers`,
        );

        if (result.summary.failed > 0) {
          process.exitCode = 1;
        }
      },
    );

  // --- gauntlet list ---
  gauntlet
    .command("list")
    .description("List available gauntlet definitions or past runs")
    .option("--runs", "show past runs instead of definitions")
    .action((opts: { runs?: boolean }) => {
      if (opts.runs) {
        const index = loadGauntletIndex();

        if (index.length === 0) {
          console.log("[boop] No gauntlet runs found.");
          return;
        }

        console.log("Gauntlet Runs:");
        console.log("");
        console.log("  Run ID                             Gauntlet         Pass/Fail  Commit");
        console.log("  " + "-".repeat(80));

        for (const entry of index) {
          const passStr = `${entry.passed}/${entry.failed}`;
          console.log(
            `  ${entry.runId.padEnd(36)} ${entry.gauntletId.padEnd(16)} ${passStr.padEnd(10)} ${entry.gitCommit.slice(0, 8)}`,
          );
        }
      } else {
        const gauntletDir = resolveGauntletDir(root);
        const gauntlets = listAvailableGauntlets(gauntletDir);

        if (gauntlets.length === 0) {
          console.log("[boop] No gauntlet definitions found.");
          return;
        }

        console.log("Available Gauntlet Definitions:");
        console.log("");
        for (const g of gauntlets) {
          console.log(`  ${g.name}`);
        }
        console.log("");
        console.log("Run a gauntlet with: boop gauntlet run <name>");
      }
    });

  // --- gauntlet report ---
  gauntlet
    .command("report")
    .description("Display a past gauntlet run's report")
    .argument("<runId>", "run ID")
    .action((runId: string) => {
      const result = loadGauntletResult(runId);
      if (!result) {
        console.error(`[boop] Run "${runId}" not found.`);
        process.exitCode = 1;
        return;
      }

      console.log(generateGauntletReport(result));
    });

  // --- gauntlet diff ---
  gauntlet
    .command("diff")
    .description("Show cumulative drift from baseline for a gauntlet run")
    .argument("<runId>", "run ID")
    .action((runId: string) => {
      const result = loadGauntletResult(runId);
      if (!result) {
        console.error(`[boop] Run "${runId}" not found.`);
        process.exitCode = 1;
        return;
      }

      const baselineTag = `gauntlet/${result.gauntletId}-baseline`;
      if (!tagExists(baselineTag, root)) {
        console.error(`[boop] Baseline tag "${baselineTag}" not found.`);
        process.exitCode = 1;
        return;
      }

      console.log(`Drift from baseline (${baselineTag}):`);
      console.log("");

      for (const tier of result.tiers) {
        if (!tagExists(tier.tags.post, root)) continue;

        const stats = getDiffStats(baselineTag, tier.tags.post, root);
        console.log(`  ${tier.tierId}:`);
        console.log(`    Files changed: ${stats.filesChanged}`);
        console.log(`    Insertions: +${stats.insertions}`);
        console.log(`    Deletions: -${stats.deletions}`);

        if (tier.tags.evolved && tagExists(tier.tags.evolved, root)) {
          const evolvedStats = getDiffStats(baselineTag, tier.tags.evolved, root);
          console.log(`  ${tier.tierId} (evolved):`);
          console.log(`    Files changed: ${evolvedStats.filesChanged}`);
          console.log(`    Insertions: +${evolvedStats.insertions}`);
          console.log(`    Deletions: -${evolvedStats.deletions}`);
        }
        console.log("");
      }
    });
}
