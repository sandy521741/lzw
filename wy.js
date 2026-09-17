"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const axios = require("axios");

const PLATFORM_NAME = "网易";
const API_BASE = "https://api2.vsaa.cn/api/music/wangyi/index.php";
const SRC_URL =
  "https://raw.githubusercontent.com/sandy521741/lzw/refs/heads/main/wangyi.js";
const pageSize = 20;

/* ---------- 用户变量（必填 key） ---------- */
function getApiKey() {
  try {
    const uv = (typeof env !== "undefined" && env?.getUserVariables?.()) || {};
    return uv.key || uv.KEY || uv.apiKey || uv.api_key || uv.token || "";
  } catch (e) {
    return "";
  }
}

async function callApi(params) {
  const key = getApiKey();
  if (!key) {
    throw new Error("请在插件设置-用户变量中填写 API Key (key)");
  }
  const res = await axios.get(API_BASE, {
    params: { ...params, key },
    timeout: 30000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36",
      Referer: "https://api2.vsaa.cn/",
    },
  });
  const d = res.data;
  if (d && d.error) throw new Error(String(d.error));
  if (
    d &&
    d.code !== undefined &&
    !["200", "0", "success", "ok"].includes(String(d.code).toLowerCase()) &&
    !d.url &&
    !d.data
  ) {
    throw new Error(d.msg || d.message || `接口 code=${d.code}`);
  }
  return d;
}

/* ---------- 播放链路加固（纯万象） ---------- */
const PLAY_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13; V2024A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36",
  Referer: "https://music.163.com/",
};

const QUALITY_CANDIDATES = {
  low: ["128k"],
  standard: ["128k", "320k"],
  high: ["320k", "128k"],
  super: ["flac", "320k", "128k"],
  "128k": ["128k"],
  "192k": ["192k", "320k", "128k"],
  "320k": ["320k", "128k"],
  flac: ["flac", "320k", "128k"],
  hires: ["hires", "flac", "320k", "128k"],
};

function ensureHttps(u) {
  return typeof u === "string" && /^http:\/\//i.test(u)
    ? u.replace(/^http:/i, "https:")
    : u;
}

function pickUrl(d) {
  if (!d) return "";
  const list = [
    d.url,
    d.mp3Url,
    d.playUrl,
    typeof d.data === "string" ? d.data : d.data && d.data.url,
    d.result && d.result.url,
  ];
  for (const c of list) {
    if (typeof c === "string" && /^https?:\/\//i.test(c)) return c;
  }
  return "";
}

async function getMediaSource(musicItem, quality) {
  const id = String(musicItem.id || "");
  if (!id) throw new Error("无法识别的歌曲ID");
  const candidates = QUALITY_CANDIDATES[quality] || [quality, "320k", "128k"];
  const tried = [];
  let lastReason = "";
  for (const q of candidates) {
    tried.push(q);
    let raw;
    try {
      raw = await callApi({ action: "musicSource", id, quality: q });
    } catch (e) {
      lastReason = e.message;
      continue;
    }
    let url = pickUrl(raw);
    if (!url) {
      try {
        url = pickUrl(await callApi({ action: "play", url: id, quality: q }));
      } catch (e) {
        lastReason = lastReason || e.message;
      }
    }
    if (url) {
      return {
        url: ensureHttps(url),
        headers: PLAY_HEADERS,
        userAgent: PLAY_HEADERS["User-Agent"],
      };
    }
    lastReason = "响应无url: " + JSON.stringify(raw).slice(0, 140);
  }
  throw new Error(`获取播放链接失败（已试 ${tried.join(">")}）：${lastReason}`);
}

/* ---------- 数据归一化 ---------- */
function normalizeMusicItem(item) {
  return {
    id: String(item.id || ""),
    title: item.title || "",
    artist: item.artist || "",
    album: item.album || "",
    albumId: item.albumId || "",
    artwork: item.artwork || item.picUrl || item.coverImg || "",
    duration: item.duration || undefined,
    qualities: item.qualities || {},
    platform: PLATFORM_NAME,
  };
}
function normalizeAlbumItem(item) {
  return {
    id: String(item.id || ""),
    title: item.title || item.name || "",
    artist: item.artist || (item.artistInfo && item.artistInfo.name) || "",
    artwork: item.artwork || item.picUrl || item.coverImg || "",
    date: item.date || undefined,
    description: item.description || "",
    worksNum: item.worksNum || item.size || 0,
  };
}
function normalizeArtistItem(item) {
  return {
    id: String(item.id || ""),
    name: item.name || item.artistName || "",
    avatar: item.avatar || item.picUrl || item.img1v1Url || "",
    worksNum: item.worksNum || item.albumSize || 0,
  };
}
// 增强：兼容万象 search/sheetInfo 可能返回的 coverImg / creator / trackCount / playCount
function normalizeSheetItem(item) {
  const artwork =
    item.artwork || item.coverImg || item.coverImgUrl || item.picUrl || "";
  const artist =
    item.artist ||
    (item.creator && (item.creator.nickname || item.creator.name)) ||
    item.nickname ||
    "";
  return {
    id: String(item.id || ""),
    title: item.title || item.name || "",
    artist,
    artwork,
    coverImg: artwork,
    description: item.description || "",
    worksNum: item.worksNum || item.trackCount || 0,
    playCount: item.playCount || undefined,
    platform: PLATFORM_NAME,
  };
}

/* ---------- 搜索（type: music/album/artist/sheet） ---------- */
async function searchBase(query, page, type) {
  const result = await callApi({ action: "search", keyword: query, page, type });
  return { isEnd: result.isEnd !== false, data: result.data || [] };
}
async function searchMusic(query, page) {
  const r = await searchBase(query, page, "music");
  return { isEnd: r.isEnd, data: r.data.map(normalizeMusicItem) };
}
async function searchAlbum(query, page) {
  const r = await searchBase(query, page, "album");
  return { isEnd: r.isEnd, data: r.data.map(normalizeAlbumItem) };
}
async function searchArtist(query, page) {
  const r = await searchBase(query, page, "artist");
  return { isEnd: r.isEnd, data: r.data.map(normalizeArtistItem) };
}
async function searchMusicSheet(query, page) {
  const r = await searchBase(query, page, "sheet");
  return { isEnd: r.isEnd, data: r.data.map(normalizeSheetItem) };
}

/* ---------- 详情 / 歌词 / 专辑 / 歌手 ---------- */
async function getMusicInfo(musicBase) {
  const id = String(musicBase.id || "");
  if (!id) return null;
  const result = await callApi({ action: "musicInfo", id });
  if (!result || !result.title) return null;
  return normalizeMusicItem(result);
}
async function getLyric(musicItem) {
  const id = String(musicItem.id || "");
  if (!id) return { rawLrc: "" };
  const result = await callApi({ action: "lyric", id });
  return {
    rawLrc: result.rawLrc || result.lrc || "",
    translation: result.translation || undefined,
  };
}
async function getAlbumInfo(albumItem) {
  const id = String(albumItem.id || "");
  if (!id) return { musicList: [] };
  const result = await callApi({ action: "albumInfo", id });
  return { musicList: (result.musicList || []).map(normalizeMusicItem) };
}
async function getArtistWorks(artistItem, page, type) {
  const id = String(artistItem.id || "");
  if (!id) return { isEnd: true, data: [] };
  const result = await callApi({
    action: "artistWorks",
    id,
    page,
    type: type === "album" ? "album" : "music",
  });
  if (type === "album") {
    return {
      isEnd: result.isEnd !== false,
      data: (result.data || []).map(normalizeAlbumItem),
    };
  }
  return {
    isEnd: result.isEnd !== false,
    data: (result.data || []).map(normalizeMusicItem),
  };
}

/* ---------- 歌单广场（用 sheet 搜索模拟，纯万象） ---------- */
// 每个 tag.id 即传给 search 的 keyword；title 即界面显示名
const TOP_PINNED = [
  { id: "热门", title: "热门" },
  { id: "热歌", title: "热歌" },
  { id: "新歌", title: "新歌" },
  { id: "飙升", title: "飙升" },
  { id: "经典", title: "经典" },
  { id: "抖音", title: "抖音" },
];
const TAG_GROUPS = [
  { title: "语种", data: ["华语", "欧美", "日语", "韩语", "古风", "粤语"] },
  { title: "风格", data: ["电子", "说唱", "民谣", "R&B", "摇滚", "轻音乐"] },
  { title: "场景", data: ["助眠", "学习", "运动", "通勤", "工作", "深夜"] },
  { title: "主题", data: ["影视", "游戏", "翻唱", "现场", "纯音乐", "儿童"] },
].map((g) => ({
  title: g.title,
  data: g.data.map((k) => ({ id: k, title: k })),
}));

async function getRecommendSheetTags() {
  return { pinned: TOP_PINNED, data: TAG_GROUPS };
}
async function getRecommendSheetsByTag(tag, page) {
  const keyword = (tag && (tag.id || tag.title)) || "热门";
  return await searchMusicSheet(keyword, page || 1);
}

/* ---------- 歌单详情 / 导入 ---------- */
// 注：万象 sheetInfo 不支持 page（参数表里 page 仅 search/artistWorks/comments），故一次全量返回
async function getMusicSheetInfo(sheet) {
  const result = await callApi({
    action: "sheetInfo",
    id: String(sheet.id || ""),
  });
  return {
    isEnd: true,
    sheetItem: normalizeSheetItem({ ...(result.sheetItem || sheet) }),
    musicList: (result.musicList || []).map(normalizeMusicItem),
  };
}
async function importMusicSheet(urlLike) {
  const result = await callApi({ action: "importSheet", url: String(urlLike).trim() });
  return (result.musicList || []).map(normalizeMusicItem);
}

/* ---------- 榜单 ---------- */
async function getTopLists() {
  return (await callApi({ action: "topLists" })) || [];
}
async function getTopListDetail(topListItem) {
  const result = await callApi({ action: "topListDetail", id: String(topListItem.id || "") });
  return { ...topListItem, musicList: (result.musicList || []).map(normalizeMusicItem) };
}
async function getMusicComments(musicItem, page = 1) {
  const result = await callApi({ action: "comments", id: String(musicItem.id || ""), page });
  return { isEnd: result.isEnd !== false, data: result.data || [] };
}

function getMusicDetailPageUrl(musicItem) {
  const id = musicItem.id;
  return id ? `https://music.163.com/song?id=${id}` : "";
}

/* ---------- 导出 ---------- */
module.exports = {
  platform: PLATFORM_NAME,
  author: "简",
  version: "1.0.6",
  srcUrl: SRC_URL,
  appVersion: ">0.1.0-alpha.0",
  cacheControl: "no-store",
  supportedQualities: ["128k", "192k", "320k", "flac", "hires"],
  userVariables: [
    { key: "key", name: "API Key", type: "string", required: true, hint: "接口调用密钥" },
  ],
  hints: {
    importMusicSheet: ["网易云APP：歌单-分享-复制链接，直接粘贴即可", "或直接输入纯数字歌单ID"],
  },
  supportedSearchType: ["music", "album", "artist", "sheet"],
  async search(query, page, type) {
    if (type === "music") return await searchMusic(query, page);
    if (type === "album") return await searchAlbum(query, page);
    if (type === "artist") return await searchArtist(query, page);
    if (type === "sheet") return await searchMusicSheet(query, page);
    return { isEnd: true, data: [] };
  },
  getMediaSource,
  getMusicInfo,
  getMusicDetailPageUrl,
  getLyric,
  getAlbumInfo,
  getArtistWorks,
  // —— 歌单广场入口 ——
  getRecommendSheetTags,
  getRecommendSheetsByTag,
  getMusicSheetInfo,
  importMusicSheet,
  importMusicItem: async (urlLike) => {
    const s = String(urlLike).trim();
    const m = s.match(/(?:id=|\/)(\d{5,})/);
    const id = m ? m[1] : /^\d+$/.test(s) ? s : "";
    const result = await getMusicInfo({ id });
    if (!result) {
      const fallback = await callApi({ action: "importItem", url: s });
      const one = Array.isArray(fallback) ? fallback[0] : fallback;
      if (!one || !one.id) throw new Error("无法识别的歌曲ID");
      return normalizeMusicItem(one);
    }
    return result;
  },
  getTopLists,
  getTopListDetail,
  getMusicComments,
};
