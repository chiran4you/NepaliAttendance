// app/(tabs)/holidays.tsx
import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import NepaliDate from "nepali-date-converter";

import Screen from "../../src/components/Screen";
import AppHeader from "../../src/components/AppHeader";
import { Colors } from "../../src/constants/colors";
import { useTenant } from "../../src/tenant/TenantContext";
import { deleteHoliday, listHolidaysForMonth, upsertHoliday } from "../../src/db/holidaysRepo";

function currentMonthBs() {
  return new NepaliDate(new Date()).format("YYYY-MM");
}
function todayBs() {
  return new NepaliDate(new Date()).format("YYYY-MM-DD");
}

export default function HolidaysScreen() {
  const { tenant } = useTenant();

  const [monthBs, setMonthBs] = useState(currentMonthBs());
  const [dateBs, setDateBs] = useState(todayBs());
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<Array<{ dateBs: string; title?: string | null }>>([]);
  const [loading, setLoading] = useState(false);

  if (!tenant) return null;
  const tenantId = tenant.tenantId;

  async function refresh() {
    setLoading(true);
    try {
      const list = await listHolidaysForMonth({ tenantId, monthBs });
      setItems(list.map((h) => ({ dateBs: h.dateBs, title: h.title })));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, monthBs]);

  async function onSave() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateBs)) {
      Alert.alert("Invalid date", "Use BS date format YYYY-MM-DD (e.g., 2082-08-15).");
      return;
    }
    try {
      await upsertHoliday({ tenantId, dateBs, title: title.trim() || undefined });
      setTitle("");
      await refresh();
      Alert.alert("Saved", "Holiday added/updated.");
    } catch (e: any) {
      Alert.alert("Failed", e?.message ?? "Could not save holiday.");
    }
  }

  async function onDelete(d: string) {
    Alert.alert("Delete holiday?", d, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteHoliday({ tenantId, dateBs: d });
          await refresh();
        },
      },
    ]);
  }

  return (
    <Screen>
      {/* ✅ Match other tabs: show school name + address in header */}
      <AppHeader name={tenant.schoolName} address={tenant.schoolAddress} />

      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.label}>BS Month (YYYY-MM)</Text>
        <TextInput value={monthBs} onChangeText={setMonthBs} style={styles.input} placeholder="2082-08" />

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Add / Update Holiday</Text>
          <Text style={styles.label}>BS Date (YYYY-MM-DD)</Text>
          <TextInput value={dateBs} onChangeText={setDateBs} style={styles.input} placeholder="2082-08-15" />
          <Text style={styles.label}>Title (optional)</Text>
          <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder="Public Holiday" />
          <Pressable onPress={onSave} style={styles.primaryBtn}>
            <Text style={styles.primaryText}>Save</Text>
          </Pressable>
        </View>

        <Text style={[styles.cardTitle, { marginTop: 16 }]}>Holidays in {monthBs}</Text>
        {loading ? <Text style={styles.muted}>Loading...</Text> : null}

        {items.length === 0 && !loading ? (
          <Text style={styles.muted}>No holidays saved for this month.</Text>
        ) : (
          items.map((h) => (
            <View key={h.dateBs} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowDate}>{h.dateBs}</Text>
                {h.title ? <Text style={styles.rowTitle}>{h.title}</Text> : <Text style={styles.muted}>No title</Text>}
              </View>
              <Pressable onPress={() => onDelete(h.dateBs)} style={styles.deleteBtn}>
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  card: { borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 12, marginTop: 12 },
  cardTitle: { fontSize: 16, fontWeight: "700", marginBottom: 8 },
  label: { marginTop: 10, marginBottom: 6, fontWeight: "600" },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  primaryBtn: {
    marginTop: 12,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  primaryText: { fontWeight: "700" },

  row: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 12, marginTop: 10 },
  rowDate: { fontWeight: "700" },
  rowTitle: { marginTop: 4 },
  muted: { opacity: 0.7, marginTop: 6 },
  deleteBtn: { paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: Colors.border, borderRadius: 10 },
  deleteText: { fontWeight: "700" },
});
