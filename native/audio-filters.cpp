// SPDX-License-Identifier: GPL-2.0-or-later
#include "audio-filters.hpp"
#include <obs-module.h>
#include <cmath>
#include <memory>
#include <set>
#include <stdexcept>

extern "C" {
extern struct obs_source_info gain_filter;
extern struct obs_source_info noise_suppress_filter_v2;
extern struct obs_source_info noise_gate_filter;
extern struct obs_source_info compressor_filter;
extern struct obs_source_info limiter_filter;
extern struct obs_source_info expander_filter;
extern struct obs_source_info upward_compressor_filter;
extern struct obs_source_info eq_filter;
extern struct obs_source_info invert_polarity_filter;
// The vendored filters name themselves through the module locale. The
// recorder has no OBS interface, so the lookup key is the name.
const char *obs_module_text(const char *value) { return value; }
}

namespace acroclip::filters {
namespace {
using nlohmann::json;
struct Parameter {
  const char *key;
  double minimum, maximum, fallback;
  bool integer;
};
struct Choice {
  const char *key;
  std::vector<std::string> values;
};
struct Fixed {
  const char *key, *value;
};
struct Kind {
  const char *name, *type;
  std::vector<Parameter> parameters;
  std::vector<Choice> choices;
  std::vector<Fixed> fixed;
};
// OBS's own ranges. src/shared/audio-filters.ts narrows them to useful values.
const std::vector<Kind> &kinds() {
  static const std::vector<Kind> value{
      {"gain", "gain_filter", {{"db", -30, 30, 0, false}}, {}, {}},
      {"noise-suppression", "noise_suppress_filter_v2", {}, {}, {{"method", "rnnoise"}}},
      {"noise-gate",
       "noise_gate_filter",
       {{"open_threshold", -96, 0, -26, false},
        {"close_threshold", -96, 0, -32, false},
        {"attack_time", 0, 10000, 25, true},
        {"hold_time", 0, 10000, 200, true},
        {"release_time", 0, 10000, 150, true}},
       {},
       {}},
      {"compressor",
       "compressor_filter",
       {{"ratio", 1, 32, 10, false},
        {"threshold", -60, 0, -18, false},
        {"attack_time", 1, 500, 6, true},
        {"release_time", 1, 1000, 60, true},
        {"output_gain", -32, 32, 0, false}},
       {},
       {{"sidechain_source", "none"}}},
      {"limiter", "limiter_filter", {{"threshold", -60, 0, -6, false}, {"release_time", 1, 1000, 60, true}}, {}, {}},
      // Expander and Gate are presets of the same filter. OBS resets every
      // setting when its preset field changes, so that field stays fixed.
      {"expander",
       "expander_filter",
       {{"ratio", 1, 20, 2, false},
        {"threshold", -60, 0, -40, false},
        {"attack_time", 1, 100, 10, true},
        {"release_time", 1, 1000, 50, true},
        {"output_gain", -32, 32, 0, false}},
       {{"detector", {"RMS", "peak"}}},
       {{"presets", "expander"}}},
      {"upward-compressor",
       "upward_compressor_filter",
       {{"ratio", 0, 1, 0.5, false},
        {"threshold", -60, 0, -20, false},
        {"attack_time", 1, 100, 10, true},
        {"release_time", 1, 1000, 50, true},
        {"output_gain", -32, 32, 0, false},
        {"knee_width", 0, 20, 10, true}},
       {},
       {{"detector", "RMS"}}},
      {"equalizer", "basic_eq_filter", {{"low", -20, 20, 0, false}, {"mid", -20, 20, 0, false}, {"high", -20, 20, 0, false}}, {}, {}},
      {"invert-polarity", "invert_polarity_filter", {}, {}, {}},
  };
  return value;
}
const Kind &kind(const std::string &name) {
  for (const auto &item : kinds())
    if (name == item.name) return item;
  throw std::runtime_error("This audio filter is unavailable");
}
const Kind &kindForType(const std::string &type) {
  for (const auto &item : kinds())
    if (type == item.type) return item;
  throw std::runtime_error("This audio filter is unavailable");
}
const char *signatureKey = "acroclip_signature";
std::string signature(const Filter &filter) { return filter.settings.dump(); }
using Data = std::unique_ptr<obs_data_t, decltype(&obs_data_release)>;
Data settingsData(const Filter &filter) {
  const auto &definition = kindForType(filter.type);
  Data data(obs_data_create(), &obs_data_release);
  for (const auto &parameter : definition.parameters) {
    const double value = filter.settings.at(parameter.key).get<double>();
    if (parameter.integer)
      obs_data_set_int(data.get(), parameter.key, static_cast<long long>(value));
    else
      obs_data_set_double(data.get(), parameter.key, value);
  }
  for (const auto &choice : definition.choices)
    obs_data_set_string(data.get(), choice.key, filter.settings.at(choice.key).get<std::string>().c_str());
  for (const auto &fixed : definition.fixed) obs_data_set_string(data.get(), fixed.key, fixed.value);
  obs_data_set_string(data.get(), signatureKey, signature(filter).c_str());
  return data;
}
struct Current {
  std::vector<obs_source_t *> filters;
  ~Current() {
    for (auto *filter : filters) obs_source_release(filter);
  }
};
}

void registerAudioFilters() {
  for (auto *info : {&gain_filter, &noise_suppress_filter_v2, &noise_gate_filter, &compressor_filter, &limiter_filter, &expander_filter,
                     &upward_compressor_filter, &eq_filter, &invert_polarity_filter})
    obs_register_source(info);
}

Chain parseChain(const json &value) {
  Chain chain;
  if (value.is_null()) return chain;
  if (!value.is_array() || value.size() > 8) throw std::runtime_error("Each audio source supports up to eight filters");
  std::set<std::string> identities;
  for (const auto &item : value) {
    if (!item.is_object()) throw std::runtime_error("The audio filter is invalid");
    const auto id = item.value("id", std::string{});
    if (id.empty() || id.size() > 200 || !identities.insert(id).second) throw std::runtime_error("The audio filter identity is invalid");
    const auto &definition = kind(item.value("kind", std::string{}));
    const auto &settings = item.contains("settings") ? item.at("settings") : json::object();
    if (!settings.is_object()) throw std::runtime_error("The audio filter settings are invalid");
    Filter filter{id, definition.type, item.value("enabled", true), json::object()};
    for (const auto &[key, entry] : settings.items()) {
      bool known = false;
      for (const auto &parameter : definition.parameters) known = known || key == parameter.key;
      for (const auto &choice : definition.choices) known = known || key == choice.key;
      if (!known) throw std::runtime_error("The audio filter settings are invalid");
    }
    for (const auto &parameter : definition.parameters) {
      const auto found = settings.find(parameter.key);
      const double number = found == settings.end() ? parameter.fallback : found->is_number() ? found->get<double>() : NAN;
      if (!std::isfinite(number) || number < parameter.minimum || number > parameter.maximum ||
          (parameter.integer && std::floor(number) != number))
        throw std::runtime_error("An audio filter setting is out of range");
      filter.settings[parameter.key] = number;
    }
    for (const auto &choice : definition.choices) {
      const auto found = settings.find(choice.key);
      const auto text = found == settings.end() ? choice.values.front() : found->is_string() ? found->get<std::string>() : std::string{};
      bool allowed = false;
      for (const auto &option : choice.values) allowed = allowed || option == text;
      if (!allowed) throw std::runtime_error("An audio filter setting is out of range");
      filter.settings[choice.key] = text;
    }
    chain.push_back(std::move(filter));
  }
  return chain;
}

void applyChain(obs_source_t *source, const Chain &chain) {
  if (!source) return;
  Current current;
  obs_source_enum_filters(
      source, [](obs_source_t *, obs_source_t *filter, void *param) { static_cast<Current *>(param)->filters.push_back(obs_source_get_ref(filter)); },
      &current);
  bool same = current.filters.size() == chain.size();
  for (size_t index = 0; same && index < chain.size(); ++index)
    same = chain[index].id == obs_source_get_name(current.filters[index]) && chain[index].type == obs_source_get_id(current.filters[index]);
  if (same) {
    for (size_t index = 0; index < chain.size(); ++index) {
      auto *filter = current.filters[index];
      Data existing(obs_source_get_settings(filter), &obs_data_release);
      // Rebuilding a filter would reset its envelope or noise model, so only
      // changed settings reach the filter.
      if (signature(chain[index]) != obs_data_get_string(existing.get(), signatureKey)) obs_source_update(filter, settingsData(chain[index]).get());
      if (obs_source_enabled(filter) != chain[index].enabled) obs_source_set_enabled(filter, chain[index].enabled);
    }
    return;
  }
  // Create the whole chain before touching the source, so a failure leaves
  // the previous filters in place rather than a partial chain.
  std::vector<obs_source_t *> created;
  try {
    for (const auto &filter : chain) {
      auto *next = obs_source_create_private(filter.type.c_str(), filter.id.c_str(), settingsData(filter).get());
      if (!next) throw std::runtime_error("The audio filter could not be created");
      obs_source_set_enabled(next, filter.enabled);
      created.push_back(next);
    }
  } catch (...) {
    for (auto *filter : created) obs_source_release(filter);
    throw;
  }
  for (auto *filter : current.filters) obs_source_filter_remove(source, filter);
  for (auto *filter : created) {
    obs_source_filter_add(source, filter);
    obs_source_release(filter);
  }
}
}
