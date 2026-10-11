// Ink imports react-devtools-core only when DEV=true and the package is
// installed (ink/build/reconciler.js). It is neither shipped nor wanted, so
// the bundle aliases it to this. It is also the build's replacement for ink's
// own devtools.js (see dropInkDevtools in scripts/build.mjs), which would
// otherwise inline `ws` and its optional native addons.
export default { connectToDevTools() {} }
