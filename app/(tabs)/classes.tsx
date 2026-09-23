// app/(tabs)/classes.tsx
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  Alert,
  StyleSheet,
  Platform,
  Modal,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router/react-navigation";

import Screen from "../../src/components/Screen";
import AppHeader from "../../src/components/AppHeader";
import { Colors } from "../../src/constants/colors";
import { useTenant } from "../../src/tenant/TenantContext";
import { usePremium } from "../../src/premium/usePremium";
import {
  assertRomeoPassPremium,
  createAndShareRomeoPass,
  importRomeoPass,
  readRomeoPassFile,
  RomeoPassPayload,
  RomeoPassPreview,
} from "../../src/premium/romeoPass";
import {
  addClass,
  updateClass,
  deleteClass,
  listClasses,
  countClasses,
  ClassItem,
} from "../../src/db/classRepo";

const MAX_CLASSES = 7;

export default function ClassesScreen() {
  const { tenant } = useTenant();
  const { premiumEnabled, reload: reloadPremium } = usePremium(tenant?.tenantId ?? null);
  const [name, setName] = useState("");
  const [section, setSection] = useState("");
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [editing, setEditing] = useState<ClassItem | null>(null);
  const [romeoOpen, setRomeoOpen] = useState(false);
  const [romeoMode, setRomeoMode] = useState<"home" | "give" | "receive">("home");
  const [romeoBusy, setRomeoBusy] = useState(false);
  const [receivePayload, setReceivePayload] = useState<RomeoPassPayload | null>(null);
  const [receivePreview, setReceivePreview] = useState<RomeoPassPreview | null>(null);
  const [receiveFileName, setReceiveFileName] = useState("");

  const refresh = async () => {
    if (!tenant) return;
    const rows = await listClasses(tenant.tenantId);
    setClasses(rows);
  };

  useEffect(() => {
    refresh();
  }, [tenant?.tenantId]);

  useFocusEffect(
    React.useCallback(() => {
      void reloadPremium();
    }, [reloadPremium])
  );

  if (!tenant) return null;

  const showPremiumRequired = () => {
    Alert.alert(
      "Romeo Pass — Premium",
      "Dā and Pratigrah require an active Premium school license on this device. Activate the school's license from Settings to continue."
    );
  };

  const openRomeoPass = async () => {
    if (!premiumEnabled) {
      showPremiumRequired();
      return;
    }
    try {
      await assertRomeoPassPremium(tenant.tenantId);
      setRomeoMode("home");
      setReceivePayload(null);
      setReceivePreview(null);
      setReceiveFileName("");
      setRomeoOpen(true);
    } catch {
      showPremiumRequired();
    }
  };

  const closeRomeoPass = () => {
    if (romeoBusy) return;
    setRomeoOpen(false);
    setRomeoMode("home");
    setReceivePayload(null);
    setReceivePreview(null);
    setReceiveFileName("");
  };

  const onShareClass = async (item: ClassItem) => {
    setRomeoBusy(true);
    try {
      const preview = await createAndShareRomeoPass({
        tenantId: tenant.tenantId,
        schoolName: tenant.schoolName,
        classId: item.id,
      });
      setRomeoOpen(false);
      Alert.alert(
        "Romeo Pass ready",
        `${preview.className}${preview.section ? ` (${preview.section})` : ""} was prepared with ${preview.studentCount} students and ${preview.attendanceDayCount} attendance days.`
      );
    } catch (error: any) {
      Alert.alert("Could not create Romeo Pass", error?.message ?? "Please try again.");
    } finally {
      setRomeoBusy(false);
    }
  };

  const chooseRomeoPass = async () => {
    setRomeoBusy(true);
    try {
      await assertRomeoPassPremium(tenant.tenantId);
      if ((await countClasses(tenant.tenantId)) >= MAX_CLASSES) {
        throw new Error(`This device already has the maximum of ${MAX_CLASSES} classes.`);
      }

      const result = await File.pickFileAsync({
        mimeTypes: ["application/json", "application/octet-stream", "text/plain", "*/*"],
        multipleFiles: false,
      });
      if (result.canceled) return;

      const pickedFile = result.result;
      const parsed = await readRomeoPassFile(await pickedFile.base64(), tenant.tenantId);
      setReceivePayload(parsed.payload);
      setReceivePreview(parsed.preview);
      setReceiveFileName(pickedFile.name || "Selected Romeo Pass");
    } catch (error: any) {
      Alert.alert("Could not read Romeo Pass", error?.message ?? "Please choose a valid Romeo Pass file.");
    } finally {
      setRomeoBusy(false);
    }
  };

  const confirmReceiveClass = async () => {
    if (!receivePayload || !receivePreview) return;
    setRomeoBusy(true);
    try {
      await importRomeoPass({
        tenantId: tenant.tenantId,
        payload: receivePayload,
        maxClasses: MAX_CLASSES,
      });
      await refresh();
      setRomeoOpen(false);
      Alert.alert(
        "Pratigrah complete",
        `${receivePreview.className}${receivePreview.section ? ` (${receivePreview.section})` : ""}, ${receivePreview.studentCount} students, and the complete attendance history are now on this device.`
      );
    } catch (error: any) {
      Alert.alert("Could not receive class", error?.message ?? "Nothing was imported.");
    } finally {
      setRomeoBusy(false);
    }
  };

  const startEdit = (item: ClassItem) => {
    setEditing(item);
    setName(item.name ?? "");
    setSection(item.section ? String(item.section) : "");
  };

  const cancelEdit = () => {
    setEditing(null);
    setName("");
    setSection("");
  };

  const onAddOrSave = async () => {
    const n = name.trim();
    const s = section.trim();

    if (!n) {
      Alert.alert("Missing", "Please enter class name (e.g., Grade 10).");
      return;
    }

    // EDIT MODE => UPDATE
    if (editing) {
      await updateClass({
        id: editing.id,
        tenantId: tenant.tenantId,
        name: n,
        section: s ? s : null,
      });
      cancelEdit();
      refresh();
      return;
    }

    // ADD MODE => INSERT (with limit check)
    const existing = await countClasses(tenant.tenantId);
    if (existing >= MAX_CLASSES) {
      Alert.alert(
        "Limit reached",
        `You can create a maximum of ${MAX_CLASSES} classes on this device.`
      );
      return;
    }

    await addClass({
      id: randomUUID(),
      tenantId: tenant.tenantId,
      name: n,
      section: s ? s : null,
      createdAt: Date.now(),
    });

    setName("");
    setSection("");
    refresh();
  };

  const confirmDelete = (item: ClassItem) => {
    Alert.alert("Delete class?", `${item.name}${item.section ? ` - ${item.section}` : ""}`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          // if you're deleting the class currently being edited, exit edit mode
          if (editing?.id === item.id) cancelEdit();

          await deleteClass(item.id, tenant.tenantId);
          refresh();
        },
      },
    ]);
  };

  const onLongPressItem = (item: ClassItem) => {
    Alert.alert(
      "Class options",
      `${item.name}${item.section ? ` - ${item.section}` : ""}`,
      [
        { text: "Edit", onPress: () => startEdit(item) },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => confirmDelete(item),
        },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  return (
    <Screen>
      <AppHeader name={tenant.schoolName} address={tenant.schoolAddress} />

      <View style={styles.content}>
        <View>
          <Text style={styles.title}>Classes</Text>
          <Text style={styles.subtle}>
            {classes.length}/{MAX_CLASSES} used
          </Text>
        </View>

        <View style={styles.card}>
          {editing ? (
            <View style={styles.editBanner}>
              <Text style={styles.editBannerText}>
                Editing:{" "}
                <Text style={{ fontWeight: "900", color: Colors.textPrimary }}>
                  {editing.name}
                  {editing.section ? ` (${editing.section})` : ""}
                </Text>
              </Text>
            </View>
          ) : null}

          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Class name (e.g., Grade 10)"
            placeholderTextColor={Colors.muted}
            style={styles.input}
          />
          <TextInput
            value={section}
            onChangeText={setSection}
            placeholder="Section (optional, e.g., A)"
            placeholderTextColor={Colors.muted}
            style={styles.input}
          />

          <Pressable
            onPress={onAddOrSave}
            disabled={!editing && classes.length >= MAX_CLASSES}
            style={({ pressed }) => [
              styles.primaryBtn,
              !editing && classes.length >= MAX_CLASSES && { opacity: 0.5 },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.primaryBtnText}>
              {editing
                ? "Save Changes"
                : classes.length >= MAX_CLASSES
                  ? "Class limit reached"
                  : "Add Class"}
            </Text>
          </Pressable>

          {/* Attractive, tight action row when editing */}
          {editing ? (
            <View style={styles.actionRow}>
              <Pressable
                onPress={cancelEdit}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Text style={styles.secondaryBtnText}>Cancel Edit</Text>
              </Pressable>

              <Pressable
                onPress={() => confirmDelete(editing)}
                style={({ pressed }) => [
                  styles.dangerBtn,
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Text style={styles.dangerBtnText}>Delete</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <FlatList
          data={classes}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ gap: 12, paddingTop: 4 }}
          renderItem={({ item }) => (
            <Pressable onLongPress={() => onLongPressItem(item)} style={styles.card}>
              <Text style={styles.className}>
                {item.name} {item.section ? `(${item.section})` : ""}
              </Text>
              <Text style={styles.subtleSmall}>Long-press for options</Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.subtle}>No classes yet.</Text>}
          ListFooterComponent={
            <Pressable
              onPress={openRomeoPass}
              style={({ pressed }) => [
                styles.romeoCard,
                pressed && { opacity: 0.9 },
              ]}
            >
              <View style={styles.romeoHeadingRow}>
                <View style={styles.romeoLogo}>
                  <Ionicons name="swap-horizontal" size={24} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.romeoTitleRow}>
                    <Text style={styles.romeoTitle}>Romeo Pass</Text>
                    <View style={styles.premiumBadge}>
                      <Ionicons name={premiumEnabled ? "diamond" : "lock-closed"} size={11} color="#92400E" />
                      <Text style={styles.premiumBadgeText}>PREMIUM</Text>
                    </View>
                  </View>
                  <Text style={styles.romeoSubtitle}>Hand over an entire class in moments</Text>
                </View>
                <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
              </View>

              <View style={styles.romeoChoiceRow}>
                <View style={styles.romeoChoicePill}>
                  <Ionicons name="paper-plane-outline" size={15} color="#DBEAFE" />
                  <Text style={styles.romeoChoiceText}>Dā · Give</Text>
                </View>
                <View style={styles.romeoChoicePill}>
                  <Ionicons name="download-outline" size={15} color="#DBEAFE" />
                  <Text style={styles.romeoChoiceText}>Pratigrah · Receive</Text>
                </View>
              </View>
              <Text style={styles.romeoFootnote}>
                Students and complete attendance history • Same school only
              </Text>
            </Pressable>
          }
        />
      </View>

      <Modal
        visible={romeoOpen}
        transparent
        animationType="slide"
        onRequestClose={closeRomeoPass}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              {romeoMode !== "home" ? (
                <Pressable
                  disabled={romeoBusy}
                  onPress={() => {
                    setRomeoMode("home");
                    setReceivePayload(null);
                    setReceivePreview(null);
                    setReceiveFileName("");
                  }}
                  style={styles.iconButton}
                >
                  <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
                </Pressable>
              ) : (
                <View style={styles.iconButton} />
              )}
              <View style={{ flex: 1, alignItems: "center" }}>
                <Text style={styles.modalTitle}>Romeo Pass</Text>
                <Text style={styles.modalSubtitle}>
                  {romeoMode === "give" ? "Dā · Give Class" : romeoMode === "receive" ? "Pratigrah · Receive Class" : "Premium Class Handover"}
                </Text>
              </View>
              <Pressable disabled={romeoBusy} onPress={closeRomeoPass} style={styles.iconButton}>
                <Ionicons name="close" size={24} color={Colors.textPrimary} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
              {romeoMode === "home" ? (
                <>
                  <Text style={styles.modalLead}>
                    Transfer a class, its students, and every saved attendance day to another premium device in your school.
                  </Text>
                  <Pressable
                    disabled={romeoBusy || classes.length === 0}
                    onPress={() => setRomeoMode("give")}
                    style={({ pressed }) => [styles.romeoAction, pressed && { opacity: 0.9 }, classes.length === 0 && { opacity: 0.5 }]}
                  >
                    <View style={[styles.actionIcon, { backgroundColor: "#DBEAFE" }]}>
                      <Ionicons name="paper-plane" size={24} color="#1D4ED8" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.actionTitle}>Dā</Text>
                      <Text style={styles.actionSubtitle}>
                        {classes.length === 0 ? "Create a class before sharing" : "Choose and share a class"}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={21} color={Colors.muted} />
                  </Pressable>

                  <Pressable
                    disabled={romeoBusy}
                    onPress={() => setRomeoMode("receive")}
                    style={({ pressed }) => [styles.romeoAction, pressed && { opacity: 0.9 }]}
                  >
                    <View style={[styles.actionIcon, { backgroundColor: "#DCFCE7" }]}>
                      <Ionicons name="download" size={24} color="#15803D" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.actionTitle}>Pratigrah</Text>
                      <Text style={styles.actionSubtitle}>Receive a Romeo Pass file</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={21} color={Colors.muted} />
                  </Pressable>
                </>
              ) : null}

              {romeoMode === "give" ? (
                <>
                  <Text style={styles.modalLead}>Select the class you want to hand over.</Text>
                  {classes.map((item) => (
                    <Pressable
                      key={item.id}
                      disabled={romeoBusy}
                      onPress={() => onShareClass(item)}
                      style={({ pressed }) => [styles.classChoice, pressed && { backgroundColor: "#EFF6FF" }]}
                    >
                      <View style={styles.classChoiceIcon}>
                        <Ionicons name="people" size={20} color={Colors.primary} />
                      </View>
                      <Text style={styles.classChoiceText}>
                        {item.name}{item.section ? ` (${item.section})` : ""}
                      </Text>
                      <Ionicons name="share-social-outline" size={20} color={Colors.primary} />
                    </Pressable>
                  ))}
                </>
              ) : null}

              {romeoMode === "receive" ? (
                <>
                  {!receivePreview ? (
                    <View style={styles.receiveEmpty}>
                      <View style={[styles.actionIcon, { width: 58, height: 58, borderRadius: 20, backgroundColor: "#DCFCE7" }]}>
                        <Ionicons name="document-attach" size={28} color="#15803D" />
                      </View>
                      <Text style={styles.receiveTitle}>Choose a Romeo Pass</Text>
                      <Text style={styles.receiveText}>
                        Only a pass created for {tenant.schoolName} can be received.
                      </Text>
                      <Pressable disabled={romeoBusy} onPress={chooseRomeoPass} style={styles.receiveButton}>
                        <Ionicons name="folder-open-outline" size={19} color="#FFFFFF" />
                        <Text style={styles.receiveButtonText}>Choose File</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={styles.previewCard}>
                      <View style={styles.previewSuccess}>
                        <Ionicons name="checkmark-circle" size={26} color={Colors.success} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.previewTitle}>
                            {receivePreview.className}{receivePreview.section ? ` (${receivePreview.section})` : ""}
                          </Text>
                          <Text numberOfLines={1} style={styles.previewFile}>{receiveFileName}</Text>
                        </View>
                      </View>
                      <View style={styles.statsRow}>
                        <View style={styles.statBox}>
                          <Text style={styles.statNumber}>{receivePreview.studentCount}</Text>
                          <Text style={styles.statLabel}>Students</Text>
                        </View>
                        <View style={styles.statBox}>
                          <Text style={styles.statNumber}>{receivePreview.attendanceDayCount}</Text>
                          <Text style={styles.statLabel}>Days</Text>
                        </View>
                        <View style={styles.statBox}>
                          <Text style={styles.statNumber}>{receivePreview.attendanceRecordCount}</Text>
                          <Text style={styles.statLabel}>Records</Text>
                        </View>
                      </View>
                      <Text style={styles.receiveText}>
                        From {receivePreview.sourceSchoolName} • Exported {new Date(receivePreview.exportedAt).toLocaleDateString()}
                      </Text>
                      <Pressable disabled={romeoBusy} onPress={confirmReceiveClass} style={styles.receiveButton}>
                        <Ionicons name="download-outline" size={19} color="#FFFFFF" />
                        <Text style={styles.receiveButtonText}>Receive Complete Class</Text>
                      </Pressable>
                      <Pressable disabled={romeoBusy} onPress={chooseRomeoPass} style={styles.chooseAnotherButton}>
                        <Text style={styles.chooseAnotherText}>Choose another file</Text>
                      </Pressable>
                    </View>
                  )}
                </>
              ) : null}
            </ScrollView>

            {romeoBusy ? (
              <View style={styles.busyOverlay}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.busyText}>Preparing Romeo Pass…</Text>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    padding: 16,
    gap: 14,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  subtle: {
    marginTop: 4,
    color: Colors.textSecondary,
  },
  subtleSmall: {
    marginTop: 6,
    fontSize: 12,
    color: Colors.textSecondary,
  },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 2 },
      default: {},
    }),
  },

  editBanner: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#C7D2FE",
    backgroundColor: "#EEF2FF",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  editBannerText: {
    fontSize: 12,
    fontWeight: "800",
    color: Colors.textSecondary,
  },

  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 12,
    color: Colors.textPrimary,
    backgroundColor: "#fff",
  },

  primaryBtn: {
    marginTop: 6,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.15,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 3 },
      default: {},
    }),
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "800",
  },

  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  secondaryBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#F8FAFC",
  },
  secondaryBtnText: {
    fontWeight: "900",
    color: Colors.textPrimary,
  },

  dangerBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
  },
  dangerBtnText: {
    fontWeight: "900",
    color: "#B42318",
  },

  className: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  romeoCard: {
    marginTop: 8,
    marginBottom: 24,
    padding: 16,
    borderRadius: 20,
    backgroundColor: "#173B7A",
    gap: 14,
    ...Platform.select({
      ios: {
        shadowColor: "#173B7A",
        shadowOpacity: 0.25,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 5 },
      default: {},
    }),
  },
  romeoHeadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  romeoLogo: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563EB",
  },
  romeoTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  romeoTitle: {
    color: "#FFFFFF",
    fontSize: 19,
    fontWeight: "900",
  },
  romeoSubtitle: {
    marginTop: 3,
    color: "#BFDBFE",
    fontSize: 12,
    fontWeight: "600",
  },
  premiumBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#FEF3C7",
  },
  premiumBadgeText: {
    color: "#92400E",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  romeoChoiceRow: {
    flexDirection: "row",
    gap: 8,
  },
  romeoChoicePill: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  romeoChoiceText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  romeoFootnote: {
    color: "#BFDBFE",
    fontSize: 11,
    textAlign: "center",
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15, 23, 42, 0.55)",
  },
  modalSheet: {
    maxHeight: "86%",
    minHeight: 410,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  modalHandle: {
    width: 42,
    height: 5,
    alignSelf: "center",
    marginTop: 9,
    borderRadius: 99,
    backgroundColor: "#CBD5E1",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  modalTitle: {
    color: Colors.textPrimary,
    fontSize: 18,
    fontWeight: "900",
  },
  modalSubtitle: {
    marginTop: 2,
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
  },
  modalContent: {
    padding: 18,
    paddingBottom: 34,
    gap: 12,
  },
  modalLead: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 4,
  },
  romeoAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
  },
  actionIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  actionTitle: {
    color: Colors.textPrimary,
    fontSize: 17,
    fontWeight: "900",
  },
  actionSubtitle: {
    marginTop: 3,
    color: Colors.textSecondary,
    fontSize: 12,
  },
  classChoice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 13,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 15,
    backgroundColor: "#FFFFFF",
  },
  classChoiceIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primarySoft,
  },
  classChoiceText: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: 15,
    fontWeight: "800",
  },
  receiveEmpty: {
    alignItems: "center",
    paddingVertical: 28,
    gap: 12,
  },
  receiveTitle: {
    color: Colors.textPrimary,
    fontSize: 18,
    fontWeight: "900",
  },
  receiveText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  receiveButton: {
    minWidth: 180,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: 13,
    backgroundColor: Colors.primary,
  },
  receiveButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
  },
  previewCard: {
    padding: 15,
    gap: 16,
    borderWidth: 1,
    borderColor: "#BBF7D0",
    borderRadius: 18,
    backgroundColor: "#F0FDF4",
  },
  previewSuccess: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  previewTitle: {
    color: Colors.textPrimary,
    fontSize: 17,
    fontWeight: "900",
  },
  previewFile: {
    marginTop: 2,
    color: Colors.textSecondary,
    fontSize: 11,
  },
  statsRow: {
    flexDirection: "row",
    gap: 8,
  },
  statBox: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DCFCE7",
  },
  statNumber: {
    color: "#166534",
    fontSize: 17,
    fontWeight: "900",
  },
  statLabel: {
    marginTop: 2,
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: "700",
  },
  chooseAnotherButton: {
    alignItems: "center",
    paddingVertical: 5,
  },
  chooseAnotherText: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: "800",
  },
  busyOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.88)",
  },
  busyText: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: "800",
  },
});
