/* Nova Bots brand layer for the web shell.
 *
 * The shell is a compiled bundle we do not build from source here, so the last
 * step of the image walks the rendered chrome and rewrites the old product
 * names. It deliberately leaves conversation content, code, inputs and
 * contenteditable text alone: only the interface is branded.
 */
(() => {
  'use strict'

  const RULES = [
    [/DeepSeek Harness/g, 'Nova Bots'],
    [/\bDS Bot's\b/g, "Nova Bots'"],
    [/\bDS Bot\b/g, 'Nova Bots'],
    [/\bDSH Desktop\b/g, 'Nova Desktop'],
    [/\bDSH Web\b/g, 'Nova Web'],
    [/\bDSH's\b/g, "Nova's"],
    [/\bDSH\b/g, 'Nova'],
    [/DeepSeek's/g, "Nova's"],
    [/DeepSeek/g, 'Nova'],
    [/\bHarness's\b/g, "Nova's"],
    [/\bHarness\b/g, 'Nova'],
    [/\bds-bot\b/g, 'nova'],
  ]

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'KBD', 'SAMP', 'SVG'])
  const SKIP_SELECTOR = [
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[data-composer-input]',
    '[class*="markdown" i]',
    '[class*="_markdown" i]',
    '[class*="_userMessage" i]',
    '[class*="_message_" i]',
    '[class*="_bubble" i]',
    '[data-message-content]',
    '.bt-cells',
    '.bt-cell',
    '.bt-bubble',
    '.bt-md',
    '.bt-brand-name',
  ].join(',')

  const brand = (text) => {
    let out = text
    for (const [pattern, name] of RULES) out = out.replace(pattern, name)
    return out
  }

  const blocked = (node) => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
    if (!element) return true
    if (SKIP_TAGS.has(element.tagName)) return true
    return Boolean(element.closest(SKIP_SELECTOR))
  }

  const rewriteText = (node) => {
    const value = node.nodeValue
    if (!value || !/(DeepSeek|DSH|DS Bot|Harness|ds-bot)/.test(value)) return
    const next = brand(value)
    if (next !== value) node.nodeValue = next
  }

  const rewriteAttribute = (element, name) => {
    if (!element.hasAttribute(name)) return
    const value = element.getAttribute(name)
    if (!value || !/(DeepSeek|DSH|DS Bot|Harness|ds-bot)/.test(value)) return
    const next = brand(value)
    if (next !== value) element.setAttribute(name, next)
  }

  const ATTRIBUTES = ['title', 'aria-label', 'placeholder', 'alt']

  const walk = (root) => {
    if (root.nodeType === Node.TEXT_NODE) {
      if (!blocked(root)) rewriteText(root)
      return
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return
    if (root.nodeType === Node.ELEMENT_NODE) {
      if (!blocked(root)) for (const name of ATTRIBUTES) rewriteAttribute(root, name)
    }
    const text = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (blocked(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    })
    let node
    while ((node = text.nextNode())) rewriteText(node)
    if (root.querySelectorAll) {
      for (const element of root.querySelectorAll('[title],[aria-label],[placeholder],[alt]')) {
        if (blocked(element)) continue
        for (const name of ATTRIBUTES) rewriteAttribute(element, name)
      }
    }
  }

  const mark = () => {
    if (document.title !== 'Nova Bots') document.title = 'Nova Bots'
    const icon = document.querySelector('link[rel="icon"]')
    if (icon && !icon.href.endsWith('/nova-icon.svg')) {
      for (const node of document.querySelectorAll('link[rel="icon"]')) node.remove()
      const link = document.createElement('link')
      link.rel = 'icon'
      link.type = 'image/svg+xml'
      link.href = './nova-icon.svg'
      document.head.append(link)
    }
  }

  let scheduled = 0
  const schedule = () => {
    if (scheduled) return
    scheduled = requestAnimationFrame(() => {
      scheduled = 0
      walk(document.body)
      mark()
    })
  }

  const start = () => {
    if (!document.querySelector('.nova-stars')) {
      const stars = document.createElement('div')
      stars.className = 'nova-stars'
      stars.setAttribute('aria-hidden', 'true')
      document.body.prepend(stars)
    }
    mark()
    walk(document.body)
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') {
          if (!blocked(record.target)) rewriteText(record.target)
        } else if (record.type === 'attributes') {
          if (record.target.nodeType === Node.ELEMENT_NODE && !blocked(record.target)) rewriteAttribute(record.target, record.attributeName)
        } else {
          for (const node of record.addedNodes) if (node.isConnected) walk(node)
        }
      }
      schedule()
    }).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRIBUTES,
    })
    new MutationObserver(mark).observe(document.querySelector('title') ?? document.head, { childList: true, subtree: true, characterData: true })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
})()
