"use client";
import { useReducer } from "react";
import Link from "next/link";
import { motion, useInView } from "motion/react";
import { useRef } from "react";
import { Icon } from "@iconify/react";

const Pricing = () => {
  const ref = useRef(null);
  interface State {
    planType: string;
    personalPrice: string;
    professionalPrice: string;
    organizationPrice: string;
    duration: string;
  }
  interface Action {
    type: "Monthly" | "Annually";
    payload: {
      duration: string;
      personalPrice: string;
      professionalPrice: string;
      organizationPrice: string;
    };
  }

  const initialTabConfig: State = {
    planType: "Monthly",
    personalPrice: "Free",
    professionalPrice: "9.00",
    organizationPrice: "18.00",
    duration: "Monthly",
  };

  function reducer(state: State, action: Action): State {
    switch (action.type) {
      case "Monthly":
        return {
          ...state,
          planType: action.type,
          personalPrice: action.payload.personalPrice,
          professionalPrice: action.payload.professionalPrice,
          organizationPrice: action.payload.organizationPrice,
          duration: action.payload.duration,
        };
      case "Annually":
        return {
          ...state,
          planType: action.type,
          personalPrice: action.payload.personalPrice,
          professionalPrice: action.payload.professionalPrice,
          organizationPrice: action.payload.organizationPrice,
          duration: action.payload.duration,
        };
      default:
        return state;
    }
  }

  const [tabConfig, dispatch] = useReducer(reducer, initialTabConfig);

  return (
    <>
      <section className="dark:bg-darkmode overflow-hidden py-14">
        <div
          ref={ref}
          className="container mx-auto lg:max-w-(--breakpoint-xl) md:max-w-(--breakpoint-md) px-4 "
        >
          <div>
            <h2 className="dark:text-white text-midnight_text text-center md:text-35 sm:text-28 text-24">
              Choose your
              <span className="text-primary max-w-max ml-2">
                preferred plan
              </span>
            </h2>
            <p className="text-base text-6 font-normal text-muted dark:text-darktext text-center m-auto py-6 lg:max-w-50% sm:max-w-75%">
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
              eiusmod tempor incididunt ut labore et dolore magna aliqua.
            </p>
          </div>
          <div>
            <div className="text-center pb-6">
              <div className="inline-flex items-center bg-hero-bg dark:bg-midnight_text dark:bg-semidark rounded-lg p-2">
                <button
                  className={`text-17 font-normal cursor-pointer text-midnight_text dark:text-white py-3 px-7 rounded-lg ${tabConfig.planType === "Monthly"
                      ? "bg-white text-darkmode dark:bg-darkmode"
                      : ""
                    }`}
                  onClick={() =>
                    dispatch({
                      type: "Monthly",
                      payload: {
                        duration: "Monthly",
                        personalPrice: "Free",
                        professionalPrice: "9.00",
                        organizationPrice: "18.00",
                      },
                    })
                  }
                >
                  Monthly
                </button>
                <button
                  className={`text-17 font-normal cursor-pointer text-midnight_text dark:text-white py-3 px-7 rounded-lg ${tabConfig.planType === "Annually"
                      ? "bg-white text-darkmode dark:bg-darkmode"
                      : ""
                    }`}
                  onClick={() =>
                    dispatch({
                      type: "Annually",
                      payload: {
                        duration: "Annually",
                        personalPrice: "Free",
                        professionalPrice: "90.00",
                        organizationPrice: "180.00",
                      },
                    })
                  }
                >
                  Annually
                </button>
              </div>
            </div>
            <div className="grid lg:grid-cols-4 md:grid-cols-2 grid-cols-1 gap-8 items-end mt-12">
              <div>
                <p className="pb-3 border-b border-border dark:border-dark_border text-muted text-17">
                  Monthly service fee
                </p>
                <p className="py-3 border-b border-border dark:border-dark_border text-muted text-17">
                  Direct debits
                </p>
                <p className="py-3 border-b border-border dark:border-dark_border text-muted text-17">
                  Online payments
                </p>
                <p className="py-3 border-b border-border dark:border-dark_border text-muted text-17">
                  Deposits to Savers
                </p>
                <p className="py-3 border-b border-border dark:border-dark_border text-muted text-17">
                  ATM withdrawals
                </p>
                <p className="py-3 border-b border-border dark:border-dark_border text-muted text-17">
                  International transaction fees
                </p>
                <p className="py-3 border-b border-border dark:border-dark_border text-muted text-17">
                  International ATM withdrawal
                </p>
                <p className="py-3 pb-5 border-b border-border dark:border-dark_border text-muted text-17">
                  Overdrawn interest rate
                </p>
              </div>
              <div className="bg-white dark:bg-midnight_text  pt-8 px-8 rounded-lg border border-border dark:border-dark_border">
                <h3 className="text-22 font-bold text-midnight_text text-center dark:text-primary">
                  Personal
                </h3>
                <div className="mt-4 flex flex-col items-center">
                  <p className="text-40 font-medium uppercase text-midnight_text dark:text-white">
                    {tabConfig.personalPrice}
                  </p>
                  <p className="text-base text-midnight_text dark:text-white">
                    {tabConfig.duration}
                  </p>
                </div>
                <Link
                  href="#"
                  className="mt-6 block text-center py-2 text-17 bg-green border-2 border-green hover:bg-transparent hover:text-green duration-300 text-white rounded-lg"
                >
                  Try for free
                </Link>
                <div className="mt-9 mb-2">
                  <p className="pb-3 text-muted text-center border-b border-border dark:border-dark_border">
                    Free
                  </p>
                  <div className="py-3 border-b border-border dark:border-dark_border flex justify-center">
                    <div className="w-6 h-6 bg-danger rounded-full flex items-center justify-center">
                      <Icon
                        icon="iconamoon:close-fill"
                        width="18"
                        height="18"
                        className="text-white"
                      />
                    </div>
                  </div>
                  <p className="py-3 border-b border-border dark:border-dark_border text-muted text-center">
                    *Free
                  </p>
                  <p className="py-3 border-b border-border dark:border-dark_border text-muted text-center">
                    *Free
                  </p>
                  <div className="py-3 border-b border-border dark:border-dark_border flex justify-center">
                    <div className="w-6 h-6 bg-danger rounded-full flex items-center justify-center">
                      <Icon
                        icon="iconamoon:close-fill"
                        width="18"
                        height="18"
                        className="text-white"
                      />
                    </div>
                  </div>
                  <div className="border-b border-border dark:border-dark_border py-3 flex justify-center">
                    <div className="w-6 h-6 bg-danger rounded-full flex items-center justify-center">
                      <Icon
                        icon="iconamoon:close-fill"
                        width="18"
                        height="18"
                        className="text-white"
                      />
                    </div>
                  </div>
                  <div className="py-3 border-b border-border dark:border-dark_border flex justify-center">
                    <div className="w-6 h-6 bg-danger rounded-full flex items-center justify-center">
                      <Icon
                        icon="iconamoon:close-fill"
                        width="18"
                        height="18"
                        className="text-white"
                      />
                    </div>
                  </div>
                  <p className="py-3 text-muted text-center">9.81% P.A.</p>
                </div>
              </div>
              <div className="bg-white dark:bg-midnight_text pt-8 px-8 rounded-lg border border-border dark:border-dark_border">
                <h3 className="text-22 font-bold text-midnight_text text-center dark:text-primary">
                  Professional
                </h3>
                <div className="mt-4 flex flex-col items-center">
                  <p className="text-40 font-medium uppercase text-midnight_text dark:text-white">
                    ${tabConfig.professionalPrice}
                  </p>
                  <p className="text-base text-midnight_text dark:text-white">
                    {tabConfig.duration}
                  </p>
                </div>
                <Link
                  href="#"
                  className="mt-6 text-17 block text-center bg-primary border-2 border-primary hover:bg-transparent hover:text-primary duration-300 text-white py-2 rounded-lg"
                >
                  Try free for 14 days
                </Link>
                <div className="mt-10 mb-2">
                  <p className="pb-3 border-b dark:border-dark_border border-border text-muted text-center">
                    Free
                  </p>
                  <div className="py-3 border-b border-border dark:border-dark_border flex justify-center">
                    <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                      <Icon
                        icon="solar:unread-outline"
                        width="18"
                        height="18"
                        className="text-white"
                      />
                    </div>
                  </div>
                  <p className="py-3 border-b border-border dark:border-dark_border text-muted text-center">
                    Free & unlimited
                  </p>
                  <p className="py-3 border-b border-border dark:border-dark_border text-muted text-center">
                    Free & unlimited
                  </p>
                  <div className="py-3 border-b border-border dark:border-dark_border flex justify-center">
                    <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                      <Icon
                        icon="solar:unread-outline"
                        width="18"
                        height="18"
                        className="text-white"
                      />
                    </div>
                  </div>
                  <p className="py-3 border-b border-border dark:border-dark_border text-muted text-center">
                    0.5%
                  </p>
                  <div className="py-3 border-b border-border dark:border-dark_border flex justify-center">
                    <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                      <Icon
                        icon="solar:unread-outline"
                        width="18"
                        height="18"
                        className="text-white"
                      />
                    </div>
                  </div>
                  <p className="py-3 text-muted text-center">9.81% P.A.</p>
                </div>
              </div>
              <div className="bg-white dark:bg-midnight_text pt-8 px-8 rounded-lg border border-border dark:border-dark_border">
                <h3 className="text-22 text-center font-bold text-midnight_text dark:text-primary">
                  Association
                </h3>
                <div className="mt-4 flex flex-col items-center">
                  <p className="text-40 font-medium uppercase text-midnight_text dark:text-white">
                    ${tabConfig.organizationPrice}
                  </p>
                  <p className="text-base text-midnight_text dark:text-white">
                    {tabConfig.duration}
                  </p>
                </div>
                <Link
                  href="#"
                  className="mt-6 text-17 block text-center bg-primary border-2 border-primary hover:bg-transparent hover:text-primary duration-300 text-white py-2 rounded-lg"
                >
                  Try free for 14 days
                </Link>
                <div className="mt-10 mb-2">
                  <p className="pb-3 border-b dark:border-dark_border border-border text-muted text-center">
                    Free
                  </p>
                  <div className="py-3 border-b border-border dark:border-dark_border flex justify-center">
                    <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                      <Icon
                        icon="solar:unread-outline"
                        width="18"
                        height="18"
                        className="text-white"
                      />
                    </div>
                  </div>
                  <p className="py-3 border-b border-border dark:border-dark_border text-muted text-center">
                    Free & unlimited
                  </p>
                  <p className="py-3 border-b border-border dark:border-dark_border text-muted text-center">
                    Free & unlimited
                  </p>
                  <div className="py-3 border-b border-border dark:border-dark_border flex justify-center">
                    <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                      <Icon
                        icon="solar:unread-outline"
                        width="18"
                        height="18"
                        className="text-white"
                      />
                    </div>
                  </div>
                  <p className="py-3 border-b border-border dark:border-dark_border text-muted text-center">
                    0.5%
                  </p>
                  <div className="py-3 border-b border-border dark:border-dark_border flex justify-center">
                    <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                      <Icon
                        icon="solar:unread-outline"
                        width="18"
                        height="18"
                        className="text-white"
                      />
                    </div>
                  </div>
                  <p className="py-3 text-muted text-center">6% P.A.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
};

export default Pricing;
