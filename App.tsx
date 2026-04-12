/**
 * Quran Reciter App
 * On-device Arabic speech-to-text using Whisper
 */

import React, { useState } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RecorderScreen from './src/screens/RecorderScreen';
import RecitationScreen from './src/screens/RecitationScreen';

type Screen = 'recorder' | 'recitation';

function App() {
  const [screen, setScreen] = useState<Screen>('recorder');

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0d1117" />
      {screen === 'recorder' ? (
        <RecorderScreen onNavigate={() => setScreen('recitation')} />
      ) : (
        <RecitationScreen onBack={() => setScreen('recorder')} />
      )}
    </SafeAreaProvider>
  );
}

export default App;
