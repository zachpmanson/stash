import TrackPlayer, { Event } from 'react-native-track-player';

export default async function service() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.reset());
  TrackPlayer.addEventListener(Event.RemoteNext, () => {});
  TrackPlayer.addEventListener(Event.RemotePrevious, () => {});
}
