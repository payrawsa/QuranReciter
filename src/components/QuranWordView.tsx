import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Pressable } from 'react-native';
import type { WordStatus } from '../services/RecitationTracker';

type Props = {
  text: string;
  status: WordStatus;
  isLast: boolean;
  onPress?: () => void;
};

const STATUS_STYLES: Record<
  WordStatus,
  { color: string; opacity: number }
> = {
  upcoming: { color: '#8899AA', opacity: 0.6 },
  active: { color: '#FFFFFF', opacity: 1 },
  correct: { color: '#5bd882', opacity: 1 },
  skipped: { color: '#f75555', opacity: 1 },
};

export const QuranWordView: React.FC<Props> = ({
  text,
  status,
  isLast,
  onPress,
}) => {
  const scale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (status === 'active') {
      // Gentle pulse for the active word
      Animated.loop(
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 1.08,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
      ).start();
      Animated.timing(glow, {
        toValue: 1,
        duration: 300,
        useNativeDriver: false,
      }).start();
    } else {
      scale.stopAnimation();
      scale.setValue(1);
      Animated.timing(glow, {
        toValue: 0,
        duration: 200,
        useNativeDriver: false,
      }).start();
    }
  }, [status, scale, glow]);

  const { color, opacity } = STATUS_STYLES[status];

  const bgColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(91,216,130,0)', 'rgba(91,216,130,0.15)'],
  });

  return (
    <Pressable onPress={onPress}>
      <Animated.View
        style={[
          styles.container,
          {
            backgroundColor: bgColor,
            transform: [{ scale }],
          },
        ]}
      >
        <Animated.Text
          style={[
            styles.text,
            { color, opacity },
            status === 'skipped' && styles.skippedText,
          ]}
        >
          {text}
          {!isLast ? ' ' : ''}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 6,
    paddingHorizontal: 2,
    paddingVertical: 1,
    marginVertical: 1,
  },
  text: {
    fontSize: 28,
    lineHeight: 52,
  },
  skippedText: {
    textDecorationLine: 'line-through',
    textDecorationColor: '#f75555',
  },
});
