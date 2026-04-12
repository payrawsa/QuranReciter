/**
 * Permission utilities for requesting microphone access at runtime (Android).
 * iOS handles this via Info.plist and system prompt automatically.
 */
import { Platform, PermissionsAndroid } from 'react-native';

export async function requestMicrophonePermission(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    // iOS prompts automatically when the audio stream starts
    return true;
  }

  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: 'Microphone Permission',
      message:
        'Quran Reciter needs access to your microphone to listen to your recitation.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    },
  );

  return granted === PermissionsAndroid.RESULTS.GRANTED;
}
