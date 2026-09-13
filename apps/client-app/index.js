import { registerRootComponent } from 'expo';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// which is what makes the app work in Expo Go and in a standalone build alike.
registerRootComponent(App);
