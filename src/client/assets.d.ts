// What esbuild's loaders turn these imports into when it bundles the page; see build-client.ts.
declare module '*.css' {
  const text: string;
  export default text;
}
declare module '*.woff2' {
  const base64: string;
  export default base64;
}
