/**
 * Benchmark CLI commands.
 *
 * Registers `boop benchmark run|list|compare` subcommands.
 */
import { Command } from "commander";
import { loadSuiteByName, resolveSuitesDir, listAvailableSuites } from "./suite-loader.js";
import { runSuite } from "./runner.js";
import { toJson, toMarkdown } from "./scorecard.js";
import { saveResult, loadResult, loadIndex, getLatestRun } from "./history.js";
import { compareRuns, comparisonToMarkdown } from "./compare.js";
import type { BenchmarkMode } from "./types.js";

/**
 * Register benchmark subcommands on the program.
 *
 * @param program - The root Commander program.
 * @param projectRoot - Project root directory (for resolving suites/fixtures).
 */
export function registerBenchmarkCommands(program: Command, projectRoot?: string): void {
  const root = projectRoot ?? process.cwd();

  const benchmark = program
    .command("benchmark")
    .description("Run benchmarks against the pipeline");

  // --- benchmark run ---
  benchmark
    .command("run")
    .description("Run a benchmark suite")
    .argument("[suite]", "suite name (default: smoke)", "smoke")
    .option("--dry-run", "use mock responses (free, fast)")
    .option("--live", "use real Claude API (costs money)")
    .option("--json", "output raw JSON to stdout")
    .action(async (suiteName: string, opts: { dryRun?: boolean; live?: boolean; json?: boolean }) => {
      let mode: BenchmarkMode | undefined;
      if (opts.dryRun) mode = "dry-run";
      if (opts.live) mode = "live";

      const suitesDir = resolveSuitesDir(root);

      let suite;
      try {
        suite = loadSuiteByName(suiteName, suitesDir);
      } catch {
        console.error(`[boop] Suite "${suiteName}" not found.`);
        console.error(`[boop] Available suites: ${listAvailableSuites(suitesDir).map((s) => s.name).join(", ") || "(none)"}`);
        process.exitCode = 1;
        return;
      }

      const effectiveMode = mode ?? suite.mode;

      if (effectiveMode === "live") {
        console.log("[boop] Running benchmark in LIVE mode — this will call the Claude API and incur costs.");
      }

      console.log(`[boop] Running suite "${suite.name}" (${effectiveMode})...`);
      console.log("");

      const result = await runSuite(suite, {
        mode: effectiveMode,
        projectRoot: root,
        onProgress: (caseId, phase, status) => {
          if (!opts.json) {
            console.log(`  [${caseId}] ${phase}: ${status}`);
          }
        },
      });

      // Save result to history
      const runId = saveResult(result);

      if (opts.json) {
        console.log(toJson(result));
      } else {
        console.log("");
        console.log(toMarkdown(result));
        console.log(`[boop] Run saved as: ${runId}`);
      }

      // Exit code: 1 if any failures
      if (result.summary.failed > 0) {
        process.exitCode = 1;
      }
    });

  // --- benchmark list ---
  benchmark
    .command("list")
    .description("List available suites or past runs")
    .option("--runs", "list past benchmark runs instead of suites")
    .action((opts: { runs?: boolean }) => {
      if (opts.runs) {
        const index = loadIndex();

        if (index.length === 0) {
          console.log("[boop] No benchmark runs found.");
          return;
        }

        console.log("Benchmark Runs:");
        console.log("");
        console.log("  Run ID                             Suite            Mode      Pass/Fail  Commit");
        console.log("  " + "-".repeat(90));

        for (const entry of index) {
          const passStr = `${entry.passed}/${entry.failed}`;
          console.log(
            `  ${entry.runId.padEnd(36)} ${entry.suiteId.padEnd(16)} ${entry.mode.padEnd(9)} ${passStr.padEnd(10)} ${entry.gitCommit}`,
          );
        }
      } else {
        const suitesDir = resolveSuitesDir(root);
        const suites = listAvailableSuites(suitesDir);

        if (suites.length === 0) {
          console.log("[boop] No benchmark suites found.");
          return;
        }

        console.log("Available Benchmark Suites:");
        console.log("");
        for (const s of suites) {
          console.log(`  ${s.name}`);
        }
        console.log("");
        console.log("Run a suite with: boop benchmark run <suite-name>");
      }
    });

  // --- benchmark compare ---
  benchmark
    .command("compare")
    .description("Compare two benchmark runs")
    .argument("<baseline>", "baseline run ID")
    .argument("[current]", "current run ID (defaults to latest run for the same suite)")
    .action((baselineId: string, currentId?: string) => {
      const baselineResult = loadResult(baselineId);
      if (!baselineResult) {
        console.error(`[boop] Baseline run "${baselineId}" not found.`);
        process.exitCode = 1;
        return;
      }

      let currentResult;
      if (currentId) {
        currentResult = loadResult(currentId);
        if (!currentResult) {
          console.error(`[boop] Current run "${currentId}" not found.`);
          process.exitCode = 1;
          return;
        }
      } else {
        // Find the latest run for the same suite
        const latest = getLatestRun(baselineResult.suiteId);
        if (!latest || latest.runId === baselineId) {
          console.error("[boop] No other run found for this suite to compare against.");
          process.exitCode = 1;
          return;
        }
        currentResult = loadResult(latest.runId);
        if (!currentResult) {
          console.error(`[boop] Could not load latest run "${latest.runId}".`);
          process.exitCode = 1;
          return;
        }
      }

      const comparison = compareRuns(baselineResult, currentResult);

      console.log(comparisonToMarkdown(comparison));

      // Exit code: 1 if regressions detected
      if (comparison.regressions.length > 0) {
        process.exitCode = 1;
      }
    });
}
