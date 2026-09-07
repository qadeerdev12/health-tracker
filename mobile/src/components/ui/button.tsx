import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ButtonProps = Omit<PressableProps, 'children'> & {
  title: string;
  variant?: 'primary' | 'plain';
  busy?: boolean;
};

export function Button({ title, variant = 'primary', busy, disabled, style, ...rest }: ButtonProps) {
  const theme = useTheme();
  const inactive = disabled || busy;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={inactive}
      {...rest}
      style={(state) => [
        styles.base,
        variant === 'primary' && { backgroundColor: theme.backgroundSelected },
        state.pressed && styles.pressed,
        inactive && styles.inactive,
        typeof style === 'function' ? style(state) : style,
      ]}>
      {busy ? (
        <ActivityIndicator color={theme.text} />
      ) : (
        <ThemedText type="smallBold" themeColor={variant === 'primary' ? 'text' : 'textSecondary'}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    minHeight: 48,
  },
  pressed: { opacity: 0.7 },
  inactive: { opacity: 0.5 },
});
