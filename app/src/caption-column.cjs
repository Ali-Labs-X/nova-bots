// The column the caption buttons of the window stand on. Our own page marks it, and the
// runtime's front end names its own columns, which the app does not know.
//
// The preload cannot require a file of its own: it runs in a sandbox, where require only
// resolves a fixed list of modules (measured with Electron 44: "module not found"). So the
// preload keeps the same function and the test checks that the two are the same text, so
// they cannot drift apart.
function captionColumn(document, mica) {
  const own = document.querySelector('[data-caption-surface]')
  if (own !== null) return own
  if (!mica) return document.querySelector('div[class*="_sidebarCol"]')
  const right = document.querySelector('div[class*="_rightbarCol"]')
  return right !== null && right.getBoundingClientRect().width > 0 ? right : document.querySelector('div[class*="_centerCol"]')
}

module.exports = { captionColumn }
