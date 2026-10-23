// Purpose: let plain Node run the app's TypeScript modules unchanged.
//
// The app imports `#lib/x.js` (and its own siblings as `./x.js`) because Vite maps those to the `.ts`
// sources. Node resolves the same specifier to a `.js` file that does not exist, so when that happens this
// hook retries the specifier with `.ts`. Node strips the types itself.

/** Retry a missing `.js` specifier as `.ts`. */
export const resolve = /** @type {import("node:module").ResolveHook} */ (
	async (specifier, context, nextResolve) => {
		try {
			return await nextResolve(specifier, context);
		} catch (error) {
			const code = /** @type {{ code?: string } | null} */ (error)?.code;
			if (code === "ERR_MODULE_NOT_FOUND" && specifier.endsWith(".js")) {
				return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
			}
			throw error;
		}
	}
);
