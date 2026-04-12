import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  FlatList,
  TextInput,
} from 'react-native';
import { QuranDatabase } from '../services/QuranDatabase';

type Props = {
  visible: boolean;
  onSelect: (surah: number, ayah: number) => void;
  onClose: () => void;
};

type SurahItem = {
  number: number;
  name: string;
  ayahCount: number;
};

export const SurahSelector: React.FC<Props> = ({
  visible,
  onSelect,
  onClose,
}) => {
  const [selectedSurah, setSelectedSurah] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const surahs = useMemo<SurahItem[]>(() => {
    const count = QuranDatabase.getSurahCount();
    const list: SurahItem[] = [];
    for (let i = 1; i <= count; i++) {
      list.push({
        number: i,
        name: QuranDatabase.getSurahName(i) ?? `Surah ${i}`,
        ayahCount: QuranDatabase.getAyahCount(i),
      });
    }
    return list;
  }, []);

  const filteredSurahs = useMemo(() => {
    if (!searchQuery) return surahs;
    const q = searchQuery.toLowerCase();
    return surahs.filter(
      s =>
        s.name.toLowerCase().includes(q) ||
        String(s.number).includes(q),
    );
  }, [surahs, searchQuery]);

  const ayahOptions = useMemo(() => {
    if (!selectedSurah) return [];
    const count = QuranDatabase.getAyahCount(selectedSurah);
    return Array.from({ length: count }, (_, i) => i + 1);
  }, [selectedSurah]);

  const handleSurahPress = (surahNum: number) => {
    setSelectedSurah(surahNum);
  };

  const handleAyahPress = (ayahNum: number) => {
    if (selectedSurah) {
      onSelect(selectedSurah, ayahNum);
      setSelectedSurah(null);
      setSearchQuery('');
    }
  };

  const handleBack = () => {
    if (selectedSurah) {
      setSelectedSurah(null);
    } else {
      setSearchQuery('');
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleBack}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={handleBack} style={styles.backButton}>
            <Text style={styles.backText}>
              {selectedSurah ? '‹ Back' : '✕'}
            </Text>
          </Pressable>
          <Text style={styles.title}>
            {selectedSurah
              ? QuranDatabase.getSurahName(selectedSurah) ?? `Surah ${selectedSurah}`
              : 'Select Surah'}
          </Text>
          <View style={styles.backButton} />
        </View>

        {/* Surah list */}
        {!selectedSurah && (
          <>
            <View style={styles.searchContainer}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search surah…"
                placeholderTextColor="#556677"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCorrect={false}
              />
            </View>
            <FlatList
              data={filteredSurahs}
              keyExtractor={item => String(item.number)}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [
                    styles.surahRow,
                    pressed && styles.rowPressed,
                  ]}
                  onPress={() => handleSurahPress(item.number)}
                >
                  <View style={styles.surahNumber}>
                    <Text style={styles.surahNumberText}>{item.number}</Text>
                  </View>
                  <View style={styles.surahInfo}>
                    <Text style={styles.surahName}>{item.name}</Text>
                    <Text style={styles.surahMeta}>
                      {item.ayahCount} ayahs
                    </Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              )}
            />
          </>
        )}

        {/* Ayah grid */}
        {selectedSurah && (
          <FlatList
            data={ayahOptions}
            keyExtractor={item => String(item)}
            numColumns={5}
            contentContainerStyle={styles.ayahGrid}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [
                  styles.ayahCell,
                  pressed && styles.ayahCellPressed,
                ]}
                onPress={() => handleAyahPress(item)}
              >
                <Text style={styles.ayahCellText}>{item}</Text>
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  backButton: {
    width: 60,
  },
  backText: {
    color: '#5bd882',
    fontSize: 18,
    fontWeight: '600',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    flex: 1,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  searchInput: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  listContent: {
    paddingBottom: 40,
  },
  surahRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  surahNumber: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(91,216,130,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  surahNumberText: {
    color: '#5bd882',
    fontSize: 13,
    fontWeight: '700',
  },
  surahInfo: {
    flex: 1,
  },
  surahName: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '500',
  },
  surahMeta: {
    color: '#556677',
    fontSize: 13,
    marginTop: 2,
  },
  chevron: {
    color: '#334455',
    fontSize: 22,
    fontWeight: '300',
  },
  ayahGrid: {
    padding: 16,
  },
  ayahCell: {
    flex: 1,
    aspectRatio: 1,
    margin: 4,
    maxWidth: '20%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  ayahCellPressed: {
    backgroundColor: 'rgba(91,216,130,0.15)',
    borderColor: '#5bd882',
  },
  ayahCellText: {
    color: '#CCDDEE',
    fontSize: 16,
    fontWeight: '600',
  },
});
