// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <string>

namespace acroclip {

/** Paths arrive as UTF-8. MSVC reads a plain std::string path in the ANSI code page, so names like "Pokémon" need this. */
inline std::filesystem::path utf8Path(const std::string &path) { return std::filesystem::u8path(path); }

namespace detail {
inline void bigEndian(std::string &out, uint32_t value) {
  for (int shift = 24; shift >= 0; shift -= 8) out.push_back(char((value >> shift) & 0xff));
}
inline std::string box(const char *type, const std::string &payload) {
  std::string out;
  bigEndian(out, uint32_t(8 + payload.size()));
  out.append(type, 4);
  return out + payload;
}
} // namespace detail

/**
 * Adds one QuickTime metadata key to a finished MP4, the same layout ffmpeg writes with
 * `-movflags use_metadata_tags`, so ffprobe reports it as a format tag. It goes in a `meta` box at
 * the end of `moov`, which OBS writes last, so only the new bytes and moov's size change and no
 * media moves. A file laid out differently is left untouched and the call returns false.
 * The box is appended before moov's size grows, so an interrupted call leaves a playable file.
 */
inline bool appendMp4Tag(const std::string &path, const std::string &key, const std::string &value) {
  using detail::bigEndian;
  using detail::box;
  std::fstream file(utf8Path(path), std::ios::in | std::ios::out | std::ios::binary);
  if (!file) return false;
  file.seekg(0, std::ios::end);
  const uint64_t length = uint64_t(file.tellg());
  uint64_t offset = 0, lastOffset = 0, lastSize = 0;
  std::string lastType;
  while (offset + 8 <= length) {
    unsigned char header[16]{};
    file.seekg(std::streamoff(offset));
    if (!file.read(reinterpret_cast<char *>(header), 8)) return false;
    uint64_t size = (uint64_t(header[0]) << 24) | (uint64_t(header[1]) << 16) | (uint64_t(header[2]) << 8) | header[3];
    // Only 32-bit sized boxes are handled. A 64-bit moov is far beyond any clip.
    if (size < 8) return false;
    lastOffset = offset;
    lastSize = size;
    lastType.assign(reinterpret_cast<char *>(header) + 4, 4);
    offset += size;
  }
  if (lastType != "moov" || offset != length) return false;
  std::string keys, ilst;
  bigEndian(keys, 0);
  bigEndian(keys, 1);
  bigEndian(keys, uint32_t(8 + key.size()));
  keys += "mdta" + key;
  std::string data;
  bigEndian(data, 1); // UTF-8 text
  bigEndian(data, 0); // default locale
  data += value;
  const std::string item = box("data", data);
  bigEndian(ilst, uint32_t(8 + item.size()));
  bigEndian(ilst, 1); // the first key
  ilst += item;
  std::string handler(8, '\0');
  handler += "mdta";
  handler += std::string(13, '\0');
  const std::string meta = box("meta", std::string(4, '\0') + box("hdlr", handler) + box("keys", keys) + box("ilst", ilst));
  if (lastSize + meta.size() > 0xffffffffull) return false;
  file.clear();
  file.seekp(std::streamoff(length));
  if (!file.write(meta.data(), std::streamsize(meta.size()))) return false;
  file.flush();
  std::string size;
  bigEndian(size, uint32_t(lastSize + meta.size()));
  file.seekp(std::streamoff(lastOffset));
  if (!file.write(size.data(), 4)) return false;
  file.flush();
  return bool(file);
}

} // namespace acroclip
