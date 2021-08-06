import { actions } from '../actions'
  
export interface State {
  badgeState: string,
  authoring: boolean
}

const MENU_ID = 'USERDOCS_ASSISTANT_CONTEXT_MENU'
const SCREENSHOT_ID = 'SCREENSHOT'
const ELEMENT_SCREENSHOT_ID = 'ELEMENT_SCREENSHOT'
const ANNOTATE_ID = 'ANNOTATE'

const SENDABLE_ACTIONS = [ actions.CREATE_ANNOTATION, actions.TEST_SELECTOR, actions.ELEMENT_SCREENSHOT ]

var PANEL_PORT: chrome.runtime.Port
var DEVTOOLS_PORT: chrome.runtime.Port

chrome.runtime.onConnect.addListener(function(port) {
  if (port.name === 'devtoolsPanel') {
    PANEL_PORT = port
    port.onMessage.addListener(function(message) {
      console.log(`Background received devtools panel ${message.action} message`)
      if(SENDABLE_ACTIONS.includes(message.action)) sendToFirstTab(message)
    })
  }
  if (port.name === 'devtools') {
    DEVTOOLS_PORT = port
    port.onMessage.addListener(function(message) {
      chrome.storage.local.get([ 'authoring' ], (result) => {
        // const authoring  =result.authoring
        if (message.action === actions.ITEM_SELECTED) {
          if (PANEL_PORT) PANEL_PORT.postMessage({ selector: message.selector }) 
          sendToFirstTab(message)
        }
      })
    })
  }
})

function boot() {
  console.debug("Booting Background Script")
  let state: State = { badgeState: 'none', authoring: false }
  chrome.storage.local.set(state)

  chrome.runtime.onMessage.addListener(message => {
    chrome.storage.local.get([ 'authoring' ], (result) => {
      const authoring  = result.authoring
      if (message.action) {
        if (message.action === actions.START) start()
        if (message.action === actions.STOP) stop()
        if (message.action === actions.click) {
          console.log("Background page, click message")
          if (DEVTOOLS_PORT) DEVTOOLS_PORT.postMessage(message)
          if (PANEL_PORT) PANEL_PORT.postMessage({ selector: message.selector }) 
          if (authoring) sendToFirstTab(message)
        }
        if (message.action === actions.load) {
          console.log("Background page, navigate message")
          if (authoring) sendToFirstTab(message)
        }
      }
    })
  })
}

function sendToFirstTab(message) {
  chrome.tabs.query({ active: true }, function(tabs){
    chrome.tabs.sendMessage(tabs[0].id, message);  
  });
}

function start() {
  console.log('start authoring')
  const state: State = { badgeState: 'yes', authoring: true }
  chrome.storage.local.set(state)
  chrome.browserAction.setBadgeText({ text: state.badgeState })

  chrome.contextMenus.removeAll()
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'UserDocs Assistant',
    contexts: ['all']
  })
  chrome.contextMenus.create({
    id: MENU_ID + SCREENSHOT_ID,
    title: 'Take Screenshot (Ctrl+Shift+S)',
    parentId: MENU_ID,
    contexts: ['all']
  })
  chrome.contextMenus.onClicked.addListener(menuInteractionhandler)

  injectScript()
}

function stop () {
  const state: State = { badgeState: '', authoring: false }
  chrome.storage.local.set(state)
  chrome.browserAction.setBadgeText({text: state.badgeState})
}

function injectScript() {
  chrome.tabs.executeScript({ file: './dist/page.js', allFrames: true })
}

function menuInteractionhandler(info, tab) {
  console.log(`Menu Interaction with ${info.menuItemId}`)
}

function handleMessage (msg, sender) {
  console.log('HandleMessage')
  if (msg.control) return this.handleControlMessage(msg, sender)

  // to account for clicks etc. we need to record the frameId and url to later target the frame in playback
  msg.frameId = sender ? sender.frameId : null
  msg.frameUrl = sender ? sender.url : null

  if (!this._isPaused) {
    this._recording.push(msg)
    chrome.storage.local.set({ recording: this._recording }, () => {
      console.debug('stored recording updated')
    })
  }
}

boot()