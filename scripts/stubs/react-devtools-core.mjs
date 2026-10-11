// Ink imports react-devtools-core only when DEV=true and the package is
// installed (ink/build/reconciler.js). It is neither shipped nor wanted, so
// the bundle aliases it to this.
export default { connectToDevTools() {} }
