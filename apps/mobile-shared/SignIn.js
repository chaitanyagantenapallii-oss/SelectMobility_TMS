/**
 * Shared sign-in screen for both mobile apps.
 *
 * Kept deliberately plain. The web login page could afford a gradient, a
 * remembered email and a Caps Lock warning because it is used at a desk; this
 * one is typed on a phone keyboard at 06:30, often once, often in a hurry.
 * What it does keep is the thing that actually saves time: an honest error
 * message, and no attempt to clear the form when the server rejects it.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { api, ApiError } from './api';
import { colors, spacing, TAP_TARGET } from './theme';

export default function SignIn({ title, subtitle, onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const e = email.trim().toLowerCase();
    if (!e || !e.includes('@')) {
      setError('Enter your email address.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await api.login(e, password);
      setPassword('');
      onSignedIn(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'That email and password do not match. Check and try again.'
          : err.message
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <View style={styles.mark}>
            <Text style={styles.markText}>{'\u{1F68C}'}</Text>
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          placeholder="you@selectmobility.in"
          placeholderTextColor={colors.textDim}
          editable={!busy}
        />

        <Text style={styles.label}>Password</Text>
        <View style={styles.pwRow}>
          <TextInput
            style={[styles.input, styles.fill]}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            placeholder="Your password"
            placeholderTextColor={colors.textDim}
            editable={!busy}
            onSubmitEditing={submit}
            returnKeyType="go"
          />
          <TouchableOpacity
            style={styles.pwToggle}
            onPress={() => setShowPassword((s) => !s)}
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
          >
            <Text style={styles.pwToggleText}>{showPassword ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, busy && styles.buttonBusy]}
          onPress={submit}
          disabled={busy}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign in</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.hint}>
          Use the account the transport desk issued you. If it does not work, ask the desk to reset it.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.bg,
  },
  brand: { alignItems: 'center', marginBottom: spacing.xl },
  mark: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  markText: { fontSize: 34 },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 14, color: colors.textDim, marginTop: 3 },

  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 6 },
  input: {
    minHeight: TAP_TARGET - 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
  },
  pwRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  pwToggle: {
    minHeight: TAP_TARGET - 4,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  pwToggleText: { fontSize: 13, fontWeight: '700', color: colors.brand },

  error: {
    fontSize: 13.5,
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
    borderRadius: 10,
    padding: 11,
    marginBottom: spacing.md,
  },

  button: {
    minHeight: TAP_TARGET,
    borderRadius: 14,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  buttonBusy: { opacity: 0.8 },
  buttonText: { fontSize: 16.5, fontWeight: '700', color: '#fff' },

  hint: {
    fontSize: 12.5,
    color: colors.textDim,
    textAlign: 'center',
    marginTop: spacing.lg,
    lineHeight: 18,
  },
});
