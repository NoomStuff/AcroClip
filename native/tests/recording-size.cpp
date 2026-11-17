#include "../recording-preset.hpp"
#include <cassert>
#include <vector>
int main(){
 using acroclip::fitResolutionLimit;
 auto wide=fitResolutionLimit({5120,2160},1080,false);assert(wide.width==2560&&wide.height==1080);
 auto portrait=fitResolutionLimit({2160,3840},1080,false);assert(portrait.width==1080&&portrait.height==1920);
 auto small=fitResolutionLimit({641,361},1080,false);assert(small.width==640&&small.height==360);
 auto app=fitResolutionLimit({2560,1440},720,true);assert(app.width==2560&&app.height==1440);
 auto original=fitResolutionLimit({2560,1440},0,false);assert(original.width==2560&&original.height==1440);
 auto waiting=fitResolutionLimit({0,0},1080,false);assert(waiting.width==0&&waiting.height==0);
 bool rejected=false;try{fitResolutionLimit({9000,1440},0,true);}catch(...){rejected=true;}assert(rejected);
 using acroclip::matchScreenRect;using acroclip::ScreenRect;
 const std::vector<ScreenRect> monitors{{0,0,1920,1080},{1920,0,4480,1440}};
 // 1920x1080 at 121% is 1587x893 scaled, which Electron converts back to 1921x1081.
 assert(matchScreenRect(ScreenRect{0,0,1921,1081},monitors)==0);
 assert(matchScreenRect(ScreenRect{0,0,1918,1080},monitors)==0);
 assert(matchScreenRect(ScreenRect{1920,0,4480,1440},monitors)==1);
 assert(matchScreenRect(ScreenRect{1919,0,4481,1441},monitors)==1);
 assert(matchScreenRect(ScreenRect{0,0,2560,1440},monitors)==-1);
 assert(matchScreenRect(ScreenRect{0,0,1920,1080},std::vector<ScreenRect>{})==-1);
}
