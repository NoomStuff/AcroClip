#include "../recording-preset.hpp"
#include <cassert>
int main(){
 using acroclip::fitResolutionLimit;
 auto wide=fitResolutionLimit({5120,2160},1080,false);assert(wide.width==2560&&wide.height==1080);
 auto portrait=fitResolutionLimit({2160,3840},1080,false);assert(portrait.width==1080&&portrait.height==1920);
 auto small=fitResolutionLimit({641,361},1080,false);assert(small.width==640&&small.height==360);
 auto app=fitResolutionLimit({2560,1440},720,true);assert(app.width==2560&&app.height==1440);
 auto original=fitResolutionLimit({2560,1440},0,false);assert(original.width==2560&&original.height==1440);
 auto waiting=fitResolutionLimit({0,0},1080,false);assert(waiting.width==0&&waiting.height==0);
 bool rejected=false;try{fitResolutionLimit({9000,1440},0,true);}catch(...){rejected=true;}assert(rejected);
}
