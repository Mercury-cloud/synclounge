
const EventEmitter = require('events')

function sendNotification (message) {
  return window.EventBus.$emit('notification', message)
}
function getHandshakeUser (user, room, password) {
  var tempUser = {
    'username': user.username,
    'room': room,
    'password': password,
    'avatarUrl': user.thumb
  }
  return tempUser
}
export default {
    state: {
      _io: require('socket.io-client'),
      _socket: null,
      ptevents: new EventEmitter(),
      ptservers: [],
      connected: false,
      server: false,
      room: false,
      password: false,
      users: [],
      messages: [],
      me: '',
      decisionBlocked: false
    },
    getters: {
      getServer: state => {
        return state.server
      },
      getMe: state => {
        return state.me
      },
      getRoom: state => {
        return state.room
      },
      getPassword: state => {
        return state.password
      },
      getUsers: state => {
        return state.users
      },
      getConnected: state => {
        return state.connected
      },
      getMessages: state => {
        return state.messages
      },
      getSocket: state => {
        return state._socket
      }
    },
    mutations: {
      SET_CONNECTED (state, value) {
        state.connected = value
      },
      SET_ME (state, value) {
        state.me = value
      },
      SET_USERS (state, value) {
        state.users = value
      },
      SET_ROOM (state, value) {
        state.room = value
      },
      SET_PASSWORD (state, value) {
        state.password = value
      },
      SET_SERVERS (state, value) {
        state.servers = value
      },
      SET_SERVER (state, value) {
        state.server = value
      },
      ADD_MESSAGE (state, msg) {
        msg.time = moment().format('h:mm A')
        state.messages.push(msg)
      },
      CLEAR_MESSAGES (state, msg) {
        state.messages = []
      }
    },
  
    actions: {
      autoJoin ({state, commit, rootState, dispatch}, data) {
        console.log('Attempting to auto join..')
        console.log(rootState)
        dispatch('socketConnect', {
          address: rootState.autoJoinUrl,
          callback: function (data) {
            console.log('Socket connection result below')
            console.log(data)
            if (!data.result) {
              console.log('Failed to connect')
            } else {
              let temporaryObj = {
                user: rootState.plex.user,
                roomName: rootState.autoJoinRoom,
                password: rootState.autoJoinPassword,
                callback: function (result) {
                  console.log(result)
                }
              }
              dispatch('joinRoom', temporaryObj)
            }
          }
        })
      },
      socketConnect ({state, commit, rootState}, data) {
        let address = data.address
        let callback = data.callback
        var that = this
        if (state._socket) {
          state._socket.disconnect()
        }
        console.log('Socket attempt connect on ' + address)
        state._socket = state._io.connect(address, {
          'forceNew': true,
          'connect timeout': 7000, path: '/ptserver/socket.io'
        })
        state._socket.on('connect', function (result) {
          // Good connection
          sendNotification('Connected to ' + address)
          callback({
            result: true,
            data: result
          })
          commit('SET_CONNECTED', true)
          commit('SET_SERVER', address)
          if (state.room) {
            // Looks like the server disconnected on us, lets rejoin
            console.log('Attempting to rejoin our room...')
            state._socket.emit('join', new getHandshakeUser(rootState.plex.user, state.room, state.password))
          }
          return
        })
        state._socket.on('connect_error', function (result) {
          // Bad connection
          console.log('Failed to connect')        
          callback({
            result: false,
            data: result
          })
          commit('SET_CONNECTED', false)
          commit('SET_SERVER', null)
          return
        })
      },
      joinRoom ({state, commit, rootState}, data) {
        var that = this
        if (!state._socket || !state.connected) {
          return data.callback(false)
        }
        commit('SET_PASSWORD', data.password)
        state._socket.emit('join', new getHandshakeUser(data.user, data.roomName, data.password))
        state._socket.on('join-result', function (result, _data, details, currentUsers) {
          commit('CLEAR_MESSAGES')
          if (result) {
            commit('SET_ROOM', _data.room)
            commit('SET_USERS', currentUsers)
            commit('SET_ME', _data.username)
            commit('SET_CHAT', true)
  
            sendNotification('Joined room: ' + _data.room)
  
            // Generate our short url/invite link
            console.log('generating our invite link')
            console.log(state)
            let webapp_socket = rootState.webapp_socket
            let url = window.location.origin
  
            let urlOrigin = window.location.origin
            let data = {
              urlOrigin: urlOrigin,
              owner: rootState.plex.user.username,
              ptserver: state.server,
              ptroom: state.room,
              ptpassword: state.password
  
            }
            var that = this
            console.log('Invite link data below')
            console.log(data)
            webapp_socket.on('shorten-result', function (shortUrl) {
              console.log('Our short url is ' + shortUrl)
              commit('SET_SHORTLINK', shortUrl)
            })
            webapp_socket.emit('shorten', data)
  
            // Now we need to setup events for dealing with the PTServer.
            // We will regularly be recieving and sending data to and from the server.
            // We want to make sure we are listening for all the server events
            state._socket.on('poll-result', function (users) {
              commit('SET_OURCLIENTRESPONSETIME', Math.abs((new Date().getTime()) - state._socket.pollStartTime))
              commit('SET_USERS', users)
            })
            state._socket.on('user-joined', function (users, user) {
              commit('SET_USERS', users)
              commit('ADD_MESSAGE', {
                msg: user.username + ' joined',
                user: user,
                type: 'alert'
              })
              console.log(users)
            })
            state._socket.on('user-left', function (users, user) {
              commit('SET_USERS', users)
              commit('ADD_MESSAGE', {
                msg: user.username + ' left the room',
                user: user,
                type: 'alert'
              })
            })
            state._socket.on('host-swap', function (user) {
              if (!user) {
                return
              }
              commit('ADD_MESSAGE', {
                msg: user.username + ' is now the host',
                user: user,
                type: 'alert'
              })
            })
            state._socket.on('host-update', function (data) {
              /* This is data from the host, we should react to this data by potentially changing
                what we're playing or seeking to get back in sync with the host.
  
                We need to limit how ourself to make sure we dont hit the client too hard.
                We'll only fetch new data if our data is older than 1000ms.
                If we need to fetch new data, we'll do that and then decide
                if we need to seek or start playing something.
                */
              rootState.hostClientResponseTime = data.clientResponseTime
              if (state.decisionBlocked) {
                console.log('We are not going to make a decision from the host data because a command is already running')
                return
              }
              console.log('Decision isnt blocked')
              if (!rootState.chosenClient) {
                console.log('We dont have a client chosen yet!')
                return
              }
              if (!rootState.chosenClient.lastTimelineObject) {
                console.log('Dont have our first timeline data yet.')
                return
              }
              // Check previous timeline data age
              let timelineAge = new Date().getTime() - rootState.chosenClient.lastTimelineObject.recievedAt
              if (timelineAge > 1000) {
                rootState.chosenClient.getTimeline(function (newtimeline) {
                  decisionMaker(0)
                  return
                })
              } else {
                decisionMaker(timelineAge)
                return
              }
  
              function decisionMaker (timelineAge) {
                let ourTimeline = rootState.chosenClient.lastTimelineObject
                let hostTimeline = data
  
                if (ourTimeline.playerState == 'buffering') {
                  return
                }
                if ((hostTimeline.playerState == 'stopped' || !hostTimeline.playerState) && ourTimeline.state != 'stopped') {
                  console.log('Pressing stop because the host did')
                  sendNotification('The host pressed stop')
                  rootState.chosenClient.pressStop(() => {
                    state.decisionBlocked = false
                  })
                  return
                }
  
                if (hostTimeline.playerState == 'stopped') {
                  return
                }
                // Check if we need to autoplay
                if ((ourTimeline.state == 'stopped' || !ourTimeline.state) && (hostTimeline.playerState != 'stopped')) {
                  if (rootState.blockAutoPlay || !hostTimeline.rawTitle) {
                    return
                  }
                  // We need to autoplay!
                  rootState.blockAutoPlay = true
                  state.decisionBlocked = true
  
                  let blockedServers = rootState.BLOCKEDSERVERS
                  let validServers = rootState.plex.servers.length
                  if (blockedServers){
                    for (let i = 0; i < blockedServers.length; i++ ){
                      if (rootState.plex.servers[blockedServers[i]]){
                        validServers--
                      }
                    }
                  }
  
                  sendNotification('Searching ' + validServers + ' Plex Servers for "' + hostTimeline.rawTitle + '"')
                  rootState.plex.playContentAutomatically(rootState.chosenClient, hostTimeline, blockedServers, hostTimeline.time, function (result) {
                    console.log('Auto play result: ' + result)
                    if (!result) {
                      sendNotification('Failed to find a compatible copy of ' + hostTimeline.rawTitle)
                    }
                    state.decisionBlocked = false
                    setTimeout(function () {
                      rootState.blockAutoPlay = false
                    }, 15000)
                  })
                  return
                }
                let difference = Math.abs((parseInt(ourTimeline.time) + parseInt(timelineAge)) - parseInt(hostTimeline.time))
  
                if (hostTimeline.playerState == 'playing' && ourTimeline.state == 'paused') {
                  sendNotification('The host pressed play')
                  rootState.chosenClient.pressPlay(function () {
                    checkForSeek()
                  })
                  return
                }
                if (hostTimeline.playerState == 'paused' && ourTimeline.state == 'playing') {
                  sendNotification('The host pressed pause')
                  rootState.chosenClient.pressPause(function () {
                    checkForSeek()
                  })
                  return
                }
                checkForSeek()
  
                function checkForSeek () {
                  if (parseInt(difference) > parseInt(rootState.SYNCFLEXABILITY)) {
                    // We need to seek!
                    console.log('STORE: we need to seek')
                    // Decide what seeking method we want to use
                    if (rootState.SYNCMODE == 'cleanseek') {
                      cleanSeek()
                      return
                    }
                    if (rootState.SYNCMODE == 'skipahead') {
                      skipAhead()
                      return
                    }
                    // Fall back to skipahead
                    skipAhead()
                    return
  
                    function skipAhead () {
                      let server = rootState.plex.servers[ourTimeline.machineIdentifier]
                      let extra = 500
                      if (parseInt(hostTimeline.time) < parseInt(ourTimeline.time) && difference < 15000) {
                        state.decisionBlocked = true
                        let sleepFor = (parseInt(difference))
  
                        // If the host is 'playing' we should seek ahead, pause for the difference and then resume
                        // If the host is 'paused' we should just seek to their position
  
                        if (hostTimeline.playerState == 'paused') {
                          rootState.chosenClient.seekTo(parseInt(hostTimeline.time), function () {
                            state.decisionBlocked = false
                          })
                          return
                        } else {
                          setTimeout(function () {
                            rootState.chosenClient.pressPlay(function (result, responseTime) {
                              state.decisionBlocked = false
                            })
                          }, difference)
                        }
                        rootState.chosenClient.pressPause(function (result, responseTime) {
                        })
                      } else {
                        state.decisionBlocked = true
                        rootState.chosenClient.seekTo(parseInt(hostTimeline.time) + 10000, function () {
                          state.decisionBlocked = false
                        })
                      }
                      return
                    }
  
                    function cleanSeek () {
                      state.decisionBlocked = true
                      rootState.chosenClient.seekTo(parseInt(hostTimeline.time), function (result) {
                        console.log('Result from within store for seek was ', result)
                        console.log('Setting decision blocked to false ')
                        state.decisionBlocked = false
                      })
                    }
                  }
                }
              }
            })
            state._socket.on('disconnect', function (data) {
              sendNotification('Disconnected from the PlexTogether server')
              if (data == 'io client disconnect') {
                console.log('We disconnected from the server')
                commit('SET_ROOM', null)
                commit('SET_PASSWORD', null)
                commit('SET_USERS', [])
                commit('SET_CONNECTED', false)
                commit('SET_SERVER', null)
                commit('SET_CHAT', false)
                state.serverError = null
              }
              if (data == 'transport close') {
                console.log('The server disconnected on us')
              }
            })
            state._socket.on('new_message', function (msgObj) {
              commit('ADD_MESSAGE', msgObj)
            })
  
          } else {
            commit('SET_ME', null)
            commit('SET_ROOM', null)
            commit('SET_PASSWORD', null)
            commit('SET_USERS', [])
            commit('SET_CHAT', false)
          }
          return data.callback(result)
        })
      },
      disconnectServer ({state, commit, rootState}) {
        state._socket.disconnect()
        commit('SET_ROOM', null)
        commit('SET_PASSWORD', null)
        commit('SET_USERS', [])
        commit('SET_CONNECTED', false)
        commit('SET_SERVER', null)
        commit('SET_CHAT', false)
      },
      sendNewMessage ({state, commit, rootState}, msg) {
        commit('ADD_MESSAGE', {
          msg: msg,
          user: {
            username: 'You',
            thumb: rootState.plex.user.thumb
          },
          type: 'message'
        })
        if (state._socket.connected) {
          state._socket.emit('send_message', {
            msg: msg,
            type: 'message'
          })
        }
      },
      transferHost ({state, commit, rootState}, username) {
        if (state._socket.connected) {
          state._socket.emit('transfer_host', {
            username: username
          })
        }
      },
      getServerList () {
      },
    }
  }