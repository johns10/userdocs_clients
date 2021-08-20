import * as Runner from '@userdocs/runner'
import {Socket, Channel} from "phoenix-channels"
import {GraphQLClient} from 'graphql-request'
import {
  createStepInstance, getConfiguration, createProcessInstance, 
  updateStepInstance as updateStepInstanceQuery,
  updateProcessInstance as updateProcessInstanceQuery,
  updateScreenshot as updateScreenshotQuery,
  createScreenshot as createScreenshotQuery
} from './query'
import { isObject } from 'util'

interface Client {
  runner: Runner.Runner,
  socket: Socket,
  userChannel: Channel,
  graphQLClient: GraphQLClient,
  store: any
}

let state = {
  runner: null,
  socket: null,
  userChannel: null,
  callbacks: {}
}

const CONFIGURATION: any = {
  automationFrameworkName: 'puppeteer',
  maxRetries: 3,
  environment: 'development',
  callbacks: {}
}

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

function updater(client, query) {
  return function(stepInstance) {
    client.graphQLClient.request(query, stepInstance)
  } 
}

export async function configure(client, userId) {
  const serverConfiguration = (await client.graphQLClient.request(getConfiguration, {id: userId})).user.configuration
  const storedConfiguration = client.store.store
  const configuration: Runner.Configuration = {...CONFIGURATION, ...serverConfiguration, ...storedConfiguration}
  configuration.callbacks.updateStepInstance = updater(client, updateStepInstanceQuery)
  configuration.callbacks.updateProcessInstance = updater(client, updateProcessInstanceQuery)
  configuration.callbacks.updateScreenshot = updater(client, updateScreenshotQuery)
  configuration.callbacks.createScreenshot = updater(client, createScreenshotQuery)
  return configuration
}

export function create(token: string, userId: number, ws_url: string, http_url: string, app: string, store: any, appPath: any, appDataPath: any) {
  const headers = {authorization: token}
  const socket = new Socket(ws_url, {params: {token: token}})
  const channel = socket.channel("user:" + userId, {app: app})
  CONFIGURATION.appPath = appPath
  CONFIGURATION.appDataPath = appDataPath
  const client: Client = {
    runner: Runner.initialize(CONFIGURATION),
    socket: socket,
    userChannel: channel,
    graphQLClient: new GraphQLClient(http_url + "/api", { headers: headers }),
    store: store
  }
  return client
}

export async function connectSocket(client: Client) {
  await client.socket.connect()
  return client
}

export async function disconnectSocket(client: Client) {
  clearInterval(client.socket.heartbeatTimer)
  await client.socket.disconnect(null, 1000, "Normal Disconnect")
  return client
}

export async function joinUserChannel(client: Client) { 
  client.userChannel.join()  
    .receive("error", resp => { throw new Error("Error while connecting to User Socket") })
    .receive("timeout", () => { throw new Error("Timeout while connecting to User Socket") })
  client.userChannel.on("command:open_browser", () => {openBrowser(client)})
  client.userChannel.on("command:close_browser", () => {closeBrowser(client)})
  client.userChannel.on("command:execute_step", (payload) => {executeStepInstance(client, payload.step_id)})
  client.userChannel.on("command:execute_process", (payload) => {executeProcess(client, payload.process_id)})
  while(client.userChannel.state != "joined") { await new Promise(resolve => setTimeout(resolve, 100)) }
  return client
}

export async function leaveUserChannel(client: Client) { 
  client.userChannel.leave()  
    .receive("error", resp => { throw new Error("Error while Leaving User Channel") })
    .receive("timeout", () => { throw new Error("Timeout while Leaving User Channel") })
  while(client.userChannel.state != "closed") { await new Promise(resolve => setTimeout(resolve, 100)) }
  return client
}

export function status() {
  return state.userChannel.state
}

export async function openBrowser(client: Client) {
  const userId = client.store.get('userId')
  const configuration: Runner.Configuration = await configure(client, userId)
  try {
    client.runner = await Runner.openBrowser(client.runner, configuration)
    client.userChannel.push("event:browser_opened", {})
  } catch(e) {
    console.log(e)
  }
  client.runner.automationFramework.browser.on('disconnected', () => browserClosed(client))
  return client
}

export async function closeBrowser(client: Client) {
  client.runner = await Runner.closeBrowser(client.runner)
  client.userChannel.push("event:browser_closed", {})
  return client
}

export async function executeStepInstance(client: Client, stepId: number) {
  const userId = client.store.get('userId')
  const stepInstance = (await client.graphQLClient.request(createStepInstance, {stepId: stepId, status: "not_started"})).createStepInstance
  const configuration = await configure(client, userId)
  return await Runner.executeStepInstance(stepInstance, client.runner, configuration)
}

export async function executeProcess(client: Client, processId: number) {
  const userId = client.store.get('userId')
  const params = {processId: processId, status: "not_started"}
  const response = (await client.graphQLClient.request(createProcessInstance, params))
  const processInstance = response.createProcessInstance
  const configuration = await configure(client, userId)
  return await Runner.executeProcessInstance(processInstance, client.runner, configuration)
}

function browserClosed(client: Client) { 
  client.userChannel.push("event:browser_closed", {})
}