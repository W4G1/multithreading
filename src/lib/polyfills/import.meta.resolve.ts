import.meta.resolve ??= async function (specifier: string, parentUrl?: string) {
  const {
    Module: { createRequire },
  } = await import("node:module");
  const require = createRequire(import.meta.url);

  return require.resolve(specifier, {
    ...(parentUrl ? { paths: [parentUrl] } : {}),
  });
};
