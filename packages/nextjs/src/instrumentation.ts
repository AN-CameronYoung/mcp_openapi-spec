import { Chalk } from "chalk";

// Auto-ingest is handled by getRetriever() on first use (src/lib/retriever.ts)
export async function register() {
	// const mood = [
	// 	'                    ',
	// 	'  ╔══════════════╗  ',
	// 	'  ║  -  ____  -  ║  ',
	// 	'  ╚══════════════╝  ',
	// 	'                    ',
	// 	'                    ',
	// ]
	const mood = [
    '                         ',
    '                         ',
    '  (╯°□°）╯︵ ┻━┻         ',
    '                         ',
    '                         ',
    '                         ',
]

	if (process.env.NEXT_RUNTIME === "nodejs") {
		const figlet = (await import("figlet")).default;
		const { Chalk } = await import("chalk")
		const chalk = new Chalk({ level: 3 }) // force truecolor

		const banner = figlet.textSync("Greg", { font: "ANSI Shadow" });
		const logoLines = banner.split('\n')
		const combined = logoLines.map((line, i) => line + (mood[i] ?? ''))

		console.log("\n", chalk.dim("─".repeat(50)), "\n");
		console.log(chalk.hex('#49cc90')(combined.join('\n')))
		// console.log(chalk.green("  ✦ Greg is ready"));
		console.log(chalk.dim("─".repeat(50)));
	}
}
