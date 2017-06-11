import Vue from 'vue'
import Router from 'vue-router'
// ===================== Pages Components ======================
import signin from './components/signin'
import signout from './components/signout'
import home from './components/home'
import application from './components/application'
import join from './components/join'

Vue.use(Router)

// ==================== Router registration ====================
export default new Router({
  mode: 'hash',
  base: '/ptweb/',
  routes: [
    {path: '/', component: home},
    {path: '/sync', component: application},
    {path: '/signin', component: signin},
    {path: '/signout', component: signout},
    {path: '/join', component: join},
    {path: '*', component: home},
  ]
})
