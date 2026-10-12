#include "mahjong-algorithm/fan_calculator.h"
#include "mahjong-algorithm/shanten.h"
#include "mahjong-algorithm/stringify.h"
#include <cstring>
#include <cstdio>
#include <string>
#include <algorithm>
using namespace mahjong;
static std::string result;
static tile_t tile_at(int i) { return i < 27 ? make_tile(static_cast<suit_t>(i / 9 + 1), i % 9 + 1) : make_tile(TILE_SUIT_HONORS, i - 26); }
extern "C" {
const char* mj_score(const char* text, int flags, int seat, int wind) {
 calculate_param_t p{}; fan_table_t f{};
 int err = parse_hand_tiles(text, std::strlen(text), &p.hand_tiles, &p.win_tile);
 if(err) {result="{\"total\":-99,\"items\":[]}";return result.c_str();}
 p.win_flag = flags;p.seat_wind=static_cast<wind_t>(seat);p.prevalent_wind=static_cast<wind_t>(wind);
 int total=calculate_fan(&p,&f);
 result="{\"total\":"+std::to_string(total)+",\"items\":[";
 bool comma=false;for(int i=1;i<FAN_TABLE_SIZE;i++)if(f[i]){
  if(comma)result+=",";comma=true;
  result+="{\"name\":\""+std::string(fan_name<>::text[i])+"\",\"value\":"+std::to_string(fan_value<>::table[i])+",\"count\":"+std::to_string(f[i])+"}";
 }result+="]}";return result.c_str();
}
const char* mj_eval(const char* text, int forms) {
 hand_tiles_t h{};tile_t serving=0; useful_table_t u{};
 int err=parse_hand_tiles(text,std::strlen(text),&h,&serving);
 if(err||serving){result="{\"shanten\":99,\"useful\":[]}";return result.c_str();}
 int best=99; auto one=[&](int n,const useful_table_t& v){if(n<best){best=n;std::memcpy(u,v,sizeof(u));}else if(n==best)for(int i=0;i<TILE_TABLE_SIZE;i++)u[i]=u[i]||v[i];};
 useful_table_t v{};one(regular_shanten(h.standing_tiles,h.tile_count,&v),v);
 if(h.pack_count==0&&(forms&2)){std::memset(v,0,sizeof(v));one(seven_pairs_shanten(h.standing_tiles,h.tile_count,&v),v);}
 if(h.pack_count==0&&(forms&4)){std::memset(v,0,sizeof(v));one(thirteen_orphans_shanten(h.standing_tiles,h.tile_count,&v),v);}
 if(h.pack_count==0&&(forms&8)){std::memset(v,0,sizeof(v));one(honors_and_knitted_tiles_shanten(h.standing_tiles,h.tile_count,&v),v);}
 if(h.pack_count<=1&&(forms&16)){std::memset(v,0,sizeof(v));one(knitted_straight_shanten(h.standing_tiles,h.tile_count,&v),v);}
 result="{\"shanten\":"+std::to_string(best)+",\"useful\":[";bool comma=false;
 for(int i=0;i<34;i++)if(u[tile_at(i)]){if(comma)result+=",";comma=true;result+=std::to_string(i);}
 result+="]}";return result.c_str();
}
const char* mj_fans(){result="[";for(int i=1;i<FAN_TABLE_SIZE;i++){if(i>1)result+=",";result+="{\"name\":\""+std::string(fan_name<>::text[i])+"\",\"value\":"+std::to_string(fan_value<>::table[i])+"}";}result+="]";return result.c_str();}
}
