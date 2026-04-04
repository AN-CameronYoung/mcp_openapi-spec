#!/usr/bin/env bun

import SpecStore from "../src/store";

async function main(): Promise<void> {
	const store = new SpecStore();
	const apis = await store.listApis();
	console.log("Ingested APIs:", apis);
	const count = await store.count();
	console.log("Total documents:", count);
}

main().catch(console.error);
